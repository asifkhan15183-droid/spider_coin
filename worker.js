const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Telegram-Init-Data"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...CORS}});
const ts=()=>Math.floor(Date.now()/1000);
const day=()=>new Date().toISOString().slice(0,10);
const enc=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
async function sign(key,data){const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return crypto.subtle.sign("HMAC",k,enc.encode(data));}
async function telegramUser(init,token){
  if(!init||!token)throw Error("Telegram login data missing");
  const p=new URLSearchParams(init), hash=p.get("hash"); if(!hash)throw Error("Invalid Telegram login");
  p.delete("hash");
  const check=[...p.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=await sign(enc.encode("WebAppData"),token), expected=hex(await sign(secret,check));
  if(expected!==hash)throw Error("Telegram authentication failed");
  const authDate=Number(p.get("auth_date")||0); if(!authDate||ts()-authDate>86400)throw Error("Please reopen the Mini App");
  const u=JSON.parse(p.get("user")||"{}");if(!u.id)throw Error("Telegram user not found");
  u.start_param=p.get("start_param")||"";return u;
}
async function setting(db,key,fallback){const r=await db.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();return r?.value??String(fallback);}
async function mainRole(env,id){if(String(id)===String(env.ADMIN_TELEGRAM_ID||""))return "main";const r=await env.DB.prepare("SELECT role FROM admin_users WHERE telegram_id=?").bind(String(id)).first();return r?.role||"user";}
async function userRow(env,u,startParam){
 const id=String(u.id),old=await env.DB.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").bind(id).first();
 if(!old){
  const ref=(u.start_param||"").startsWith("ref_")?String(u.start_param).slice(4):"";
  const valid=ref&&ref!==id?await env.DB.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").bind(ref).first():null;
  await env.DB.prepare(`INSERT INTO users(telegram_id,username,first_name,last_name,balance,mining_rate,mining_started_at,mining_claimed_at,referred_by,created_at)
  VALUES(?,?,?,?,0,1,?,?,?,?)`).bind(id,u.username||"",u.first_name||"",u.last_name||"",ts(),ts(),valid?ref:null,ts()).run();
 }else await env.DB.prepare("UPDATE users SET username=?,first_name=?,last_name=? WHERE telegram_id=?").bind(u.username||"",u.first_name||"",u.last_name||"",id).run();
 const row=await env.DB.prepare("SELECT * FROM users WHERE telegram_id=?").bind(id).first();
 if(row.is_banned)throw Error("Your account is banned");
 return row;
}
async function qualifyReferral(env,referredId){
 const child=await env.DB.prepare("SELECT referred_by,referral_rewarded_at FROM users WHERE telegram_id=?").bind(referredId).first();
 if(!child?.referred_by||child.referral_rewarded_at)return {qualified:false};
 // This conditional update is the one-time lock against duplicate claims.
 const lock=await env.DB.prepare("UPDATE users SET referral_rewarded_at=? WHERE telegram_id=? AND referral_rewarded_at IS NULL AND referred_by IS NOT NULL").bind(ts(),referredId).run();
 if(!lock.meta.changes)return {qualified:false};
 const inviter=child.referred_by;
 const base=Number(await setting(env.DB,"referral_reward",25));
 await env.DB.batch([
  env.DB.prepare("UPDATE users SET referrals=referrals+1,balance=balance+? WHERE telegram_id=?").bind(base,inviter),
  env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'referral','Qualified referral reward',?)").bind(inviter,base,ts())
 ]);
 const count=Number((await env.DB.prepare("SELECT referrals FROM users WHERE telegram_id=?").bind(inviter).first())?.referrals||0);
 const milestones=[
  {n:10,key:"referral_milestone_10",fallback:200,tier:"Verified"},
  {n:200,key:"referral_milestone_200",fallback:1000,tier:"VIP"},
  {n:1000,key:"referral_milestone_1000",fallback:10000,tier:"VVIP"}
 ];
 let milestone=null;
 for(const m of milestones){
  if(count>=m.n){
   const exists=await env.DB.prepare("SELECT 1 FROM referral_milestones WHERE telegram_id=? AND milestone=?").bind(inviter,m.n).first();
   if(!exists){
    const bonus=Number(await setting(env.DB,m.key,m.fallback));
    const ins=await env.DB.prepare("INSERT OR IGNORE INTO referral_milestones(telegram_id,milestone,reward,awarded_at) VALUES(?,?,?,?)").bind(inviter,m.n,bonus,ts()).run();
    if(ins.meta.changes){
     await env.DB.batch([
      env.DB.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?").bind(bonus,inviter),
      env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'referral_milestone',?,?)").bind(inviter,bonus,`${m.tier} ${m.n} referral milestone`,ts())
     ]);
     milestone={tier:m.tier,referrals:m.n,reward:bonus};
    }
   }
  }
 }
 return {qualified:true,baseReward:base,referrals:count,milestone};
}

async function body(req){try{return await req.json()}catch{return {}}}
async function handle(req,env){
 if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
 const url=new URL(req.url);
 if(url.pathname==="/api/health")return reply({ok:true,app:"SPIDER COIN"});
 if(!url.pathname.startsWith("/api/"))return env.ASSETS.fetch(req);
 const init=req.headers.get("X-Telegram-Init-Data");
 let tg;try{tg=await telegramUser(init,env.BOT_TOKEN)}catch(e){return reply({error:e.message},401)}
 let me;try{me=await userRow(env,tg,url.searchParams.get("startapp")||"")}catch(e){return reply({error:e.message},403)}
 const id=String(tg.id),role=await mainRole(env,id),admin=role==="main"||role==="sub";
 if(req.method==="GET"&&url.pathname==="/api/bootstrap"){
  const [tasks,settings,checkins,leaders,milestones]=await Promise.all([
   env.DB.prepare("SELECT id,title,url,reward FROM tasks WHERE active=1 ORDER BY id LIMIT 10").all(),
   env.DB.prepare("SELECT key,value FROM settings").all(),
   env.DB.prepare("SELECT day_no,reward FROM checkin_rewards ORDER BY day_no").all(),
   env.DB.prepare("SELECT telegram_id,username,first_name,referrals FROM users WHERE referrals>0 AND is_banned=0 ORDER BY referrals DESC,created_at ASC LIMIT 10").all(),
   env.DB.prepare("SELECT milestone,reward,awarded_at FROM referral_milestones WHERE telegram_id=? ORDER BY milestone").bind(id).all()
  ]);
  const today=day(), claimed=await env.DB.prepare("SELECT id FROM task_runs WHERE telegram_id=? AND day_key=? AND claimed_at IS NOT NULL").bind(id,today).all();
  const started=await env.DB.prepare("SELECT task_id,started_at,claimed_at FROM task_runs WHERE telegram_id=? AND day_key=?").bind(id,today).all();
  const settingMap=Object.fromEntries(settings.results.map(x=>[x.key,x.value]));
  return reply({user:{id,username:tg.username||"",first_name:tg.first_name||"",last_name:tg.last_name||"",balance:me.balance,mining_rate:me.mining_rate,mining_started_at:me.mining_started_at,mining_claimed_at:me.mining_claimed_at,referrals:me.referrals,tasks_completed:me.tasks_completed,role},
   tasks:tasks.results,taskRuns:started.results,checkins:checkins.results,settings:settingMap,checkin:await env.DB.prepare("SELECT day_no,claimed_on FROM checkins WHERE telegram_id=? ORDER BY claimed_on DESC LIMIT 1").bind(id).first(),
   referralLink:`https://t.me/SPC_Wallet_bot?startapp=ref_${id}`,
   referral:{qualifiedCount:me.referrals||0,qualified:!!me.referral_rewarded_at,tier:(me.referrals>=1000?"VVIP":me.referrals>=200?"VIP":me.referrals>=10?"Verified":"Member"),milestones:milestones.results,leaders:leaders.results},
   withdrawalText:settingMap.withdrawal_text||"Withdrawal Start in 2027"});
 }
 if(req.method==="GET"&&url.pathname==="/api/referrals"){
  const leaders=await env.DB.prepare("SELECT telegram_id,username,first_name,referrals FROM users WHERE referrals>0 AND is_banned=0 ORDER BY referrals DESC,created_at ASC LIMIT 50").all();
  const milestones=await env.DB.prepare("SELECT milestone,reward,awarded_at FROM referral_milestones WHERE telegram_id=? ORDER BY milestone").bind(id).all();
  return reply({referrals:me.referrals||0,tier:(me.referrals>=1000?"VVIP":me.referrals>=200?"VIP":me.referrals>=10?"Verified":"Member"),milestones:milestones.results,leaders:leaders.results});
 }
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const b=await body(req);
 if(url.pathname==="/api/mining/claim"){
  const min=Number(await setting(env.DB,"mining_claim_min",10)),rate=Number(me.mining_rate||1),last=Number(me.mining_claimed_at||me.mining_started_at||ts());
  const amount=Math.max(0,(ts()-last)*rate/86400);
  if(amount<min)return reply({error:`Minimum claim is ${min} SPC`,pending:amount,minimum:min},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET balance=balance+?,mining_claimed_at=? WHERE telegram_id=?").bind(amount,ts(),id),
   env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'mining','Mining claim',?)").bind(id,amount,ts())
  ]);
  const referral=await qualifyReferral(env,id);
  return reply({ok:true,claimed:amount,referral});
 }
 if(url.pathname==="/api/task/start"){
  const task=await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND active=1").bind(Number(b.taskId)).first();if(!task)return reply({error:"Task not found"},404);
  const today=day();
  await env.DB.prepare("INSERT OR IGNORE INTO task_runs(telegram_id,task_id,started_at,day_key) VALUES(?,?,?,?)").bind(id,task.id,ts(),today).run();
  const run=await env.DB.prepare("SELECT started_at,claimed_at FROM task_runs WHERE telegram_id=? AND task_id=? AND day_key=?").bind(id,task.id,today).first();
  return reply({ok:true,startedAt:run.started_at,claimed:!!run.claimed_at});
 }
 if(url.pathname==="/api/task/claim"){
  const task=await env.DB.prepare("SELECT id,reward FROM tasks WHERE id=? AND active=1").bind(Number(b.taskId)).first();if(!task)return reply({error:"Task not found"},404);
  const run=await env.DB.prepare("SELECT started_at,claimed_at FROM task_runs WHERE telegram_id=? AND task_id=? AND day_key=?").bind(id,task.id,day()).first();
  if(!run)return reply({error:"Open the task first"},400);if(run.claimed_at)return reply({error:"Already claimed today"},400);
  if(ts()-run.started_at<30)return reply({error:"Please spend at least 30 seconds on this task"},400);
  const reward=Number(task.reward);
  await env.DB.batch([
   env.DB.prepare("UPDATE task_runs SET claimed_at=? WHERE telegram_id=? AND task_id=? AND day_key=? AND claimed_at IS NULL").bind(ts(),id,task.id,day()),
   env.DB.prepare("UPDATE users SET balance=balance+?,tasks_completed=tasks_completed+1 WHERE telegram_id=?").bind(reward,id),
   env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'task','Daily task reward',?)").bind(id,reward,ts())
  ]);
  return reply({ok:true,reward});
 }
 if(url.pathname==="/api/checkin/claim"){
  const last=await env.DB.prepare("SELECT day_no,claimed_on FROM checkins WHERE telegram_id=? ORDER BY claimed_on DESC LIMIT 1").bind(id).first();
  if(last&&last.claimed_on===day())return reply({error:"Today's check-in already claimed"},400);
  const next=last?(last.claimed_on===new Date(Date.now()-86400000).toISOString().slice(0,10)?Math.min(21,last.day_no+1):1):1;
  const rw=await env.DB.prepare("SELECT reward FROM checkin_rewards WHERE day_no=?").bind(next).first();
  if(!rw)return reply({error:"Check-in reward is not configured"},400);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO checkins(telegram_id,day_no,claimed_on) VALUES(?,?,?)").bind(id,next,day()),
   env.DB.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?").bind(Number(rw.reward),id),
   env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'checkin',?,?)").bind(id,Number(rw.reward),`Day ${next} check-in`,ts())
  ]);
  return reply({ok:true,day:next,reward:Number(rw.reward)});
 }
 if(url.pathname==="/api/wallet/send"){
  const amount=Number(b.amount),recipient=String(b.recipient||"").trim();
  const min=Number(await setting(env.DB,"wallet_send_min",100));
  if(!Number.isFinite(amount)||amount<min)return reply({error:`Minimum send is ${min} SPC`},400);
  if(me.tasks_completed<10)return reply({error:"Complete at least 10 tasks before sending SPC"},400);
  if(!recipient||recipient===id)return reply({error:"Invalid recipient Telegram ID"},400);
  const to=await env.DB.prepare("SELECT telegram_id,is_banned FROM users WHERE telegram_id=?").bind(recipient).first();
  if(!to||to.is_banned)return reply({error:"Recipient not found"},404);
  if(Number(me.balance)<amount)return reply({error:"Insufficient balance"},400);
  const res=await env.DB.prepare("UPDATE users SET balance=balance-? WHERE telegram_id=? AND balance>=?").bind(amount,id,amount).run();
  if(!res.meta.changes)return reply({error:"Insufficient balance"},400);
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET balance=balance+? WHERE telegram_id=?").bind(amount,recipient),
   env.DB.prepare("INSERT INTO transfers(from_id,to_id,amount,created_at) VALUES(?,?,?,?)").bind(id,recipient,amount,ts()),
   env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'send',?,?)").bind(id,-amount,`Sent to ${recipient}`,ts()),
   env.DB.prepare("INSERT INTO ledger(telegram_id,amount,kind,note,created_at) VALUES(?,?,'receive',?,?)").bind(recipient,amount,`Received from ${id}`,ts())
  ]);
  return reply({ok:true});
 }
 if(url.pathname==="/api/admin/subadmin"){
  if(role!=="main")return reply({error:"Main admin only"},403);
  const target=String(b.telegramId||"").trim();if(!/^\d+$/.test(target))return reply({error:"Enter numeric Telegram ID"},400);
  await env.DB.prepare("INSERT OR REPLACE INTO admin_users(telegram_id,role,created_at) VALUES(?,'sub',?)").bind(target,ts()).run();return reply({ok:true});
 }
 if(url.pathname==="/api/admin/ban"){
  if(!admin)return reply({error:"Admin only"},403);
  const target=String(b.telegramId||"").trim(),ban=!!b.ban;
  if(role==="sub"&&target===String(env.ADMIN_TELEGRAM_ID))return reply({error:"Cannot change main admin"},403);
  await env.DB.prepare("UPDATE users SET is_banned=? WHERE telegram_id=?").bind(ban?1:0,target).run();return reply({ok:true});
 }
 if(url.pathname==="/api/admin/settings"){
  if(role!=="main")return reply({error:"Main admin only"},403);
  const allowed=["mining_claim_min","wallet_send_min","daily_mining_rate","referral_reward","referral_milestone_10","referral_milestone_200","referral_milestone_1000","task_reward","withdrawal_text"];
  for(const k of allowed)if(b[k]!==undefined)await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").bind(k,String(b[k])).run();
  if(Array.isArray(b.checkinRewards)){
   for(let n=1;n<=21;n++){const val=Number(b.checkinRewards[n-1]);if(Number.isFinite(val)&&val>=0)await env.DB.prepare("INSERT OR REPLACE INTO checkin_rewards(day_no,reward) VALUES(?,?)").bind(n,val).run();}
  }
  return reply({ok:true});
 }
 if(url.pathname==="/api/admin/task"){
  if(role!=="main")return reply({error:"Main admin only"},403);
  const title=String(b.title||"").slice(0,100),link=String(b.url||"");
  if(!title||!/^https:\/\/|^http:\/\//i.test(link))return reply({error:"Task title and valid URL required"},400);
  await env.DB.prepare("INSERT INTO tasks(title,url,reward,active,created_at) VALUES(?,?,?,1,?)").bind(title,link,Number(b.reward||13),ts()).run();return reply({ok:true});
 }
 return reply({error:"Unknown endpoint"},404);
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(e){return reply({error:e.message||"Server error"},500)}}};

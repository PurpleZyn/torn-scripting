// ==UserScript==
// @name         Torn Financial Analyzer
// @namespace    local.torn.finance.analyzer
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/PurpleZyn/torn-scripting/main/financial-analyzer/financial-analyzer.user.js
// @downloadURL  https://raw.githubusercontent.com/PurpleZyn/torn-scripting/main/financial-analyzer/financial-analyzer.user.js
// @description  Export a private financial snapshot and historical activity for analysis. Read-only; no external analytics.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
(() => {
  'use strict';
  const VERSION='1.0.1', ORIGIN='https://api.torn.com', STORAGE='tfa_api_key_v1';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const unix=()=>Math.floor(Date.now()/1000);
  const money=n=>typeof n==='number'?'$'+n.toLocaleString('en-US'):'Unavailable';
  const numeric=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
  const CANCEL=Symbol('cancel');
  let busy=false, cancelled=false, report=null, lastRequest=0, calls=0;
  let ui;
  function redact(value,key){
    if(typeof value==='string') return key?value.split(key).join('[REDACTED]'):value;
    if(Array.isArray(value))return value.map(v=>redact(v,key));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
      .filter(([k])=>! /^(key|api[_-]?key|authorization|access[_-]?token|_metadata)$/i.test(k))
      .map(([k,v])=>[key?k.split(key).join('[REDACTED]'):k,redact(v,key)]));
    return value;
  }
  function safeURL(path,params={}){
    const u=new URL(path,ORIGIN);
    if(u.origin!==ORIGIN||!u.pathname.startsWith('/v2/'))throw Error('Unexpected API URL; request blocked.');
    for(const k of [...u.searchParams.keys()])if(/^(key|api[_-]?key|authorization)$/i.test(k))u.searchParams.delete(k);
    for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
    u.searchParams.set('comment','TornFinancialAnalyzer');
    return u;
  }
  function requestOnce(url,key){return new Promise((resolve,reject)=>{
    GM_xmlhttpRequest({method:'GET',url:String(url),headers:{Authorization:'ApiKey '+key,Accept:'application/json'},anonymous:true,redirect:'error',timeout:30000,
      onload:r=>{try{const data=JSON.parse(r.responseText);if(data.error){const e=Error(`Torn API error ${data.error.code}: ${data.error.error||'Request refused'}`);e.code=Number(data.error.code);throw e;}if(r.status<200||r.status>=300){const e=Error('HTTP '+r.status);e.status=r.status;throw e;}resolve(data);}catch(e){reject(e);}},
      onerror:()=>reject(Error('Network request failed')),ontimeout:()=>reject(Error('Request timed out')),onabort:()=>reject(Error('Request aborted'))});
  });}
  async function wait(ms){const until=Date.now()+ms;while(Date.now()<until){if(cancelled)throw CANCEL;await sleep(Math.min(500,until-Date.now()));}}
  async function api(path,key,params={}){
    const url=safeURL(path,params);
    for(let attempt=0;attempt<3;attempt++){
      if(cancelled)throw CANCEL;
      await wait(Math.max(0,1600-(Date.now()-lastRequest)));lastRequest=Date.now();calls++;
      try{return await requestOnce(url,key);}catch(e){
        if(cancelled)throw CANCEL;
        if(attempt===2||(!(e.code===5||e.code===8||e.code===9||e.status===429||e.status>=500||/Network|timed out/i.test(e.message))))throw e;
        const delay=e.code===5||e.status===429?65000:5000*(attempt+1);status('API temporarily unavailable; retrying in '+Math.round(delay/1000)+' seconds…');await wait(delay);
      }
    }
  }
  function status(s){if(ui)ui.status.textContent=s;}
  function note(s){if(ui){ui.details.textContent+=s+'\n';ui.details.scrollTop=ui.details.scrollHeight;}}
  function issue(r,section,error,key){r.errors.push({section,message:redact(String(error?.message||error),key)});note('⚠ '+section+': '+redact(String(error?.message||error),key));}
  function asRows(value){if(Array.isArray(value))return value;if(value&&typeof value==='object')return Object.entries(value).map(([id,row])=>row&&typeof row==='object'?{id,...row}:{id,value:row});return [];}
  // Inventory may be structured rather than an array: retain individual page bodies exactly.
  async function pagedSnapshot(path,section,key,r){
    const pages=[];r.snapshot[section]={pages,complete:false};let next=safeURL(path).href;const visited=new Set();
    while(next){if(cancelled)throw CANCEL;const url=safeURL(next).href;if(visited.has(url))throw Error('Repeated pagination URL');visited.add(url);if(pages.length>=1000)throw Error('Safety page limit reached');
      status('Collecting '+section+' (page '+(pages.length+1)+')…');const raw=await api(url,key);pages.push(redact(raw,key));next=raw._metadata?.links?.next||null;
    }
    r.snapshot[section].complete=true;
  }
  const financialWords=/\b(bank|vault|cayman|stock|dividend|interest|company|job|salary|wage|pay(?:ment|out|day)?|dues|rent(?:al|ed)?|property|upkeep|rehab(?:ilitation)?|drug|xanax|refill|points?|gym|crime|market|bazaar|shop|trade|purchase|buy|bought|sell|sold|sale|cash|money|deposit|withdraw(?:al|n)?|transfer|fee|tax|reward|casino|bookie|poker|lottery|gambl\w*|travel|flight|item|mug(?:ging|ged)?|bounty|faction|auction|donat\w*|hospital|medical|revive|energy|booster|education|mission|racing|loan|church|museum|city find)\b/i;
  const privateWords=/\b(chat message|mail message|message sent|message received|password|api key|authentication|login|logout|private message)\b/i;
  const monetaryFields=/^(money|cash|cost|price|total_cost|total_price|fee|profit|payout|payment|salary|wage|reward_money|money_gained|money_lost|amount_money|rent|upkeep|interest|deposited|withdrawn|money_sent|money_received|money_earned|money_spent)$/i;
  function hasMoney(value){return value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>(monetaryFields.test(k)&&typeof v==='number')||hasMoney(v));}
  function label(row){return [row.details?.category,row.details?.title,row.category,row.title,row.details?.name].filter(x=>typeof x==='string').join(' / ')||String(row.details?.id??row.log??row.type??'Unknown');}
  function shouldExport(row,all){const title=label(row);return !privateWords.test(title)&&(all||financialWords.test(title)||hasMoney(row.data));}
  function logID(row){return String(row.id??row.log_id??row.hash??row.nanostamp??JSON.stringify(row));}
  function scanRow(row,history,seen,key,all){const id=logID(row);if(seen.has(id))return false;seen.add(id);const ts=Number(row.timestamp);if(!Number.isFinite(ts)){history.invalidTimestamp++;return false;}if(ts<history.from||ts>history.to)return false;
    history.scanned++;history.oldest=history.oldest===null?ts:Math.min(ts,history.oldest);history.newest=history.newest===null?ts:Math.max(ts,history.newest);
    const name=label(row);if(Object.hasOwn(history.typeCounts,name))history.typeCounts[name]++;else Object.defineProperty(history.typeCounts,name,{value:1,writable:true,enumerable:true,configurable:true});
    if(shouldExport(row,all))history.entries.push(redact(row,key));else history.excluded++;
    return true;
  }
  async function historyFetch(key,r,all){
    const h=r.history;const seen=new Set(),visited=new Set();const base='/v2/user/log';let next=safeURL(base,{from:h.from,to:h.to,sort:'DESC',limit:100}).href;
    while(next){if(cancelled)throw CANCEL;const url=safeURL(next).href;if(visited.has(url))throw Error('Repeated log pagination URL; history may be incomplete.');visited.add(url);
      if(h.pages>=10000)throw Error('Safety limit of 10,000 log pages reached.');
      const data=await api(url,key);const payload=data.log??data.logs;if(!payload||typeof payload!=='object')throw Error('Log response format not recognized.');const rows=asRows(payload);h.pages++;let added=0;for(const row of rows)if(scanRow(row,h,seen,key,all))added++;
      status(`History: ${h.pages} pages · ${h.scanned.toLocaleString()} scanned · ${h.entries.length.toLocaleString()} retained${h.oldest?' · '+new Date(h.oldest*1000).toISOString().slice(0,10):''}`);
      if(h.pages%10===0)note('Scanned '+h.scanned.toLocaleString()+' log entries so far.');
      // The log API can return a null next link on a full page. Walk the time cursor explicitly.
      if(!rows.length)break;
      const oldest=Math.min(...rows.map(row=>Number(row.timestamp)).filter(Number.isFinite));
      if(!Number.isFinite(oldest))throw Error('Cannot determine log cursor.');
      if(oldest<h.from)break;
      const md=data._metadata||{}, cursor=md.nanostamp;
      if(rows.length<100 && !(rows.length===99 && cursor!=null))break;
      const current=new URL(url), currentTo=Number(current.searchParams.get('to')||h.to);
      if(oldest>currentTo)throw Error('Log endpoint returned records outside its cursor.');
      const params={from:h.from,to:oldest,sort:'DESC',limit:100};
      if(cursor!=null)params.nanostamp=String(cursor);
      const candidate=safeURL(base,params).href;
      if(visited.has(candidate)||added===0)throw Error('Log cursor stalled; history may be incomplete.');
      next=candidate;
    }
    if(h.invalidTimestamp)throw Error('Some logs have invalid timestamps; history may be incomplete.');
    h.complete=true;h.entries.sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
  }
  function summarize(r){const m=r.snapshot.money?.money;const wallet=numeric(m?.wallet),faction=numeric(m?.faction?.money),vault=numeric(m?.vault),cayman=numeric(m?.cayman_bank),company=numeric(m?.company);const bank=m?.city_bank;
    const fields=[wallet,faction,vault,cayman].filter(v=>v!==null);
    r.summary={wallet,personalFactionMoney:faction,personalFactionPoints:numeric(m?.faction?.points),propertyVault:vault,caymanBank:cayman,companyFundsSeparate:company,points:numeric(m?.points),knownPersonalCashSubtotal:fields.length?fields.reduce((a,b)=>a+b,0):null,personalCashFieldsAvailable:fields.length,cityBank:bank??null,cityBankExpectedPayout:numeric(bank?.amount),cityBankOriginalPrincipal:typeof bank?.amount==='number'&&typeof bank?.profit==='number'?bank.amount-bank.profit:null,notes:['Subtotal excludes company funds, bank investments, stocks and items. Access to faction/property/Cayman funds may be conditional.','Historical entries are raw evidence, not calculated profit. Transfers and asset sales must be reconciled separately.']};
    if(ui){ui.summary.textContent=`Wallet: ${money(wallet)}\nPersonal faction balance: ${money(faction)}\nProperty vault: ${money(vault)}\nCayman bank: ${money(cayman)}\nKnown personal cash subtotal: ${money(r.summary.knownPersonalCashSubtotal)}\nCompany funds (separate): ${money(company)}\nCity bank expected payout: ${money(r.summary.cityBankExpectedPayout)}\nLogs retained: ${r.history.entries.length.toLocaleString()} / ${r.history.scanned.toLocaleString()} scanned\nAPI calls: ${calls} | Warnings: ${r.errors.length}`;}
  }
  async function run(){
    if(busy)return;const key=ui.key.value.trim();if(!/^[A-Za-z0-9]{16}$/.test(key)){status('Enter your 16-character Torn API key.');return;}
    if(ui.remember.checked)GM_setValue(STORAGE,key);else GM_deleteValue(STORAGE);
    busy=true;cancelled=false;calls=0;report=null;ui.start.disabled=true;ui.stop.disabled=false;ui.download.disabled=true;ui.details.textContent='';ui.summary.textContent='';
    const to=unix(),days=Number(ui.days.value),all=ui.all.checked;
    const r={format:'torn-financial-analyzer',version:VERSION,createdAt:new Date().toISOString(),status:'running',snapshot:{},errors:[],history:{requestedDays:days,from:to-days*86400,to,mode:all?'all activity':'financial candidate filter',pages:0,scanned:0,excluded:0,invalidTimestamp:0,oldest:null,newest:null,complete:false,typeCounts:{},entries:[]}};report=r;
    try{
      // Verify personal money first; permission errors are recorded rather than filled with zeros.
      const tasks=[['money','/v2/user/money'],['merits','/v2/user/merits'],['networth','/v2/user/networth'],['stocks','/v2/user/stocks'],['properties','/v2/user/properties',true],['profile','/v2/user/profile'],['job','/v2/user/job'],['perks','/v2/user/perks'],['companyProfile','/v2/company/profile'],['bankRates','/v2/torn/bank'],['stockMarket','/v2/torn/stocks'],['itemCatalog','/v2/torn/items'],['logCategories','/v2/torn/logcategories'],['logTypes','/v2/torn/logtypes']];
      if(ui.inventory.checked)tasks.push(['bazaar','/v2/user/bazaar',true],['itemMarket','/v2/user/itemmarket',true],['display','/v2/user/display',true]);
      for(const [name,path,paged] of tasks){if(cancelled)throw CANCEL;status('Collecting '+name+'…');try{if(paged)await pagedSnapshot(path,name,key,r);else r.snapshot[name]=redact(await api(path,key),key);note('✓ '+name);}catch(e){if(e===CANCEL)throw e;issue(r,name,e,key);if(name==='money'&&[2,12,13,18].includes(e.code))throw Error('API key could not be used. Check your key and permissions.');}}
      if(ui.inventory.checked){
        const cats=['Collectible','Clothing','Other','Tool','Melee','Defensive','Material','Car','Primary','Secondary','Book','Special','Supply Pack','Temporary','Enhancer','Artifact','Flower','Booster','Medical','Candy','Jewelry','Alcohol','Plushie','Drug','Energy Drink'];
        const inv={categories:{},complete:false};r.snapshot.inventory=inv;
        for(const cat of cats){if(cancelled)throw CANCEL;const section='inventory:'+cat;
          try{await pagedSnapshot(safeURL('/v2/user/inventory',{cat,limit:100}).href,section,key,r);}
          catch(e){if(e===CANCEL)throw e;issue(r,section,e,key);}
          finally{if(r.snapshot[section]){inv.categories[cat]=r.snapshot[section];delete r.snapshot[section];}}
        }
        inv.complete=cats.every(cat=>inv.categories[cat]?.complete===true);
      }
      try{await historyFetch(key,r,all);note('✓ Activity history finished.');}catch(e){if(e===CANCEL)throw e;issue(r,'history',e,key);}
      r.status=r.errors.length||!r.history.complete?'completed_with_warnings':'completed';status(r.status==='completed'?'Collection complete. Download your report.':'Collection finished with warnings. You can still download the partial report.');
    }catch(e){if(e===CANCEL){r.status='cancelled';status('Stopped. You can download collected data.');}else{issue(r,'run',e,key);r.status='failed';status('Collection stopped due to an error. Review warnings.');}}
    finally{r.finishedAt=new Date().toISOString();r.apiCalls=calls;summarize(r);busy=false;ui.start.disabled=false;ui.stop.disabled=true;ui.download.disabled=false;}
  }
  function download(){if(!report||busy)return;const key=ui.key.value.trim();const clean=redact(report,key);const blob=new Blob([JSON.stringify(clean,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Torn_Financial_Report_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function mount(){if(ui)return;const host=document.createElement('div');host.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483646;';document.body.append(host);const root=host.attachShadow({mode:'closed'});
    root.innerHTML=`<style>*{box-sizing:border-box} :host{font:13px Arial,sans-serif;color:#e4e9f0} button,input,select{font:inherit} button{cursor:pointer;border:1px solid #53647d;border-radius:6px;color:#e7edf5;background:#263549;padding:9px 12px} button:hover{background:#354b66} button:disabled{opacity:.45;cursor:default} .launch{background:#253d54;box-shadow:0 3px 14px #0006;font-weight:bold} .panel{width:min(455px,calc(100vw - 36px));max-height:calc(100vh - 75px);overflow:auto;background:#17212d;border:1px solid #526278;border-radius:10px;box-shadow:0 12px 40px #0009;padding:16px;margin-bottom:8px} .hide{display:none} header{display:flex;align-items:center;justify-content:space-between;gap:10px} h2{font-size:17px;margin:0} p{color:#aebdce;line-height:1.45;margin:8px 0 12px} label{display:block;margin:9px 0} input[type=password],select{display:block;width:100%;color:#f0f3f8;background:#101923;border:1px solid #526278;border-radius:5px;padding:9px;margin:5px 0} .actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px} .primary{background:#225a46;border-color:#3c8b6a} .small{font-size:11px;color:#aebdce} pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;background:#101923;padding:9px;border-radius:6px;max-height:150px;overflow:auto;margin:8px 0} #status{color:#c4e3ff;font-weight:bold;line-height:1.4;margin-top:12px} a{color:#9dcafa}</style>
    <section class="panel hide" id="panel"><header><h2>Financial Analyzer <span class="small">v${VERSION}</span></h2><button id="close" aria-label="Close">×</button></header><p>Personal snapshot and transaction history. Requests go only to Torn's official API; the report stays on this device.</p><label>API key<input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="16-character key"></label><label><input id="remember" type="checkbox"> Remember key locally in Tampermonkey</label><button id="forget">Forget saved key</button> <a href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener noreferrer">Manage Torn API keys</a><label>History window<select id="days"><option>30</option><option>60</option><option selected>90</option><option>180</option></select></label><label><input id="inventory" type="checkbox" checked> Include inventory, bazaar, display and market listings</label><label><input id="all" type="checkbox"> Export all activity logs (may include unrelated private activity)</label><div class="small">Default: scan all accessible logs, export likely financial entries plus counts of excluded types. Full or suitably scoped custom key needed for logs.</div><div class="actions"><button class="primary" id="start">Collect report</button><button id="stop" disabled>Stop</button><button id="download" disabled>Download JSON</button></div><div id="status" role="status">Ready.</div><pre id="summary"></pre><pre id="details"></pre><p class="small">Review the JSON before sharing. It may contain sensitive in-game financial and activity data, but the script strips the API key.</p></section><button class="launch" id="launch">Financial Analyzer</button>`;
    ui=Object.fromEntries(['panel','key','remember','days','inventory','all','start','stop','download','status','summary','details','close','launch','forget'].map(x=>[x,root.getElementById(x)]));const saved=GM_getValue(STORAGE,'');ui.key.value=saved;ui.remember.checked=!!saved;
    ui.launch.onclick=()=>ui.panel.classList.toggle('hide');ui.close.onclick=()=>ui.panel.classList.add('hide');ui.start.onclick=run;ui.stop.onclick=()=>{cancelled=true;status('Stopping after the current request…');};ui.download.onclick=download;ui.forget.onclick=()=>{GM_deleteValue(STORAGE);ui.key.value='';ui.remember.checked=false;status('Saved key removed.');};GM_registerMenuCommand('Open Financial Analyzer',()=>ui.panel.classList.remove('hide'));
  }
  if(document.body)mount();else window.addEventListener('DOMContentLoaded',mount,{once:true});
})();

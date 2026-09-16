/* ---------- 2.9.1 learning reliability: session director + weekly audit ---------- */
function smAdaptiveCalibration(topicId){
  var now=Date.now(), arr=[];
  Object.keys(state.mcq||{}).forEach(function(k){
    var m=state.mcq[k]; if(!m||m.topicId!==topicId) return;
    (m.attempts||[]).forEach(function(a){ if((a.t||0)>now-90*DAY && Number(a.conf)>0) arr.push(a); });
  });
  arr.sort(function(a,b){return (a.t||0)-(b.t||0);});
  var n=arr.length, certain=arr.filter(function(a){return Number(a.conf)===3;}), unsure=arr.filter(function(a){return Number(a.conf)===2;}), guessed=arr.filter(function(a){return Number(a.conf)===1;});
  function rate(xs){return xs.length?xs.filter(function(a){return a.outcome==='right';}).length/xs.length:null;}
  var ca=rate(certain), ua=rate(unsure), ga=rate(guessed);
  var gap=ca==null?0:Math.max(0,Math.min(1,ca));
  var stateName=n<5?'unknown':(ca!=null&&ca<.65?'overconfident':(ca!=null&&ca>=.85?'well-calibrated':'mixed'));
  return {n:n,certain:certain.length,unsure:unsure.length,guessed:guessed.length,certainAcc:ca,unsureAcc:ua,guessedAcc:ga,state:stateName};
}
function smAdaptiveCalibrationSummary(){
  var rows=[];
  SM.CURRICULUM.forEach(function(t){var c=smAdaptiveCalibration(t.i); if(c.n>=5) rows.push({t:t,c:c});});
  rows.sort(function(a,b){
    var ax=a.c.certainAcc==null?1:a.c.certainAcc, bx=b.c.certainAcc==null?1:b.c.certainAcc;
    return ax-bx || b.c.n-a.c.n;
  });
  var certain=rows.filter(function(x){return x.c.certainAcc!=null;});
  var avg=certain.length?certain.reduce(function(a,x){return a+x.c.certainAcc;},0)/certain.length:null;
  var over=certain.filter(function(x){return x.c.state==='overconfident';});
  return {rows:rows.slice(0,5),avg:avg,over:over.slice(0,3),sample:rows.reduce(function(a,x){return a+x.c.n;},0)};
}
function smAdaptiveCalibrationCard(){
  var a=smAdaptiveCalibrationSummary();
  if(!a.rows.length) return card('<div class="row-top"><span class="eyebrow drape">Calibration</span><span class="muted sm">building signal</span></div><p class="muted sm">After 5+ scored questions on a topic, the engine can compare what you <b>felt</b> with what you actually retrieved. That helps it choose repair versus recall versus new learning.</p>',"drape");
  var rows=a.rows.map(function(x){
    var pct=x.c.certainAcc==null?'—':Math.round(x.c.certainAcc*100)+'%';
    var tag=x.c.state==='overconfident'?' · slow down':' · stable';
    return '<div class="row-top" style="margin-top:7px"><span class="sm">'+esc(x.t.n)+'</span><span class="muted sm">Certain: '+pct+tag+'</span></div>';}).join('');
  return card('<div class="row-top"><span class="eyebrow drape">Calibration</span><span class="muted sm">'+a.sample+' scored attempts</span></div>'+ '<p class="muted sm">The engine separates <b>not knowing</b> from <b>thinking you know</b>. '+(a.avg!=null?'Across measured topics, certain answers are '+Math.round(a.avg*100)+'% correct.':'Keep logging confidence to build the signal.')+'</p>'+rows+(a.over.length?'<p class="muted sm"><b>Calibration repair:</b> '+esc(a.over.map(function(x){return x.t.n;}).join(', '))+'. Prefer closed-notes retrieval before more input.</p>':'')+'<p class="muted sm">Calibration is a training signal, not a score or judgement.</p>',"drape");
}

function smAdaptiveTopics(date){
  var now=Date.now(), out=[], dueMap={};
  (SM.dueQueue(state.misses,now,999).queue||[]).forEach(function(m){ dueMap[m.topicId]=(dueMap[m.topicId]||0)+1; });
  var exam=SM.nextExam(plan.P,date), examSoon=!!(exam&&SM.daysBetween(date,exam.iso)<=45);
  SM.CURRICULUM.forEach(function(t){
    var sc=state.scores[t.i]||{}, n=(sc.ba||0)+(sc.sa||0), acc=n?((sc.bc||0)+(sc.sc||0))/n:null;
    var arr=[]; Object.keys(state.mcq||{}).forEach(function(k){var q=state.mcq[k];if(q&&q.topicId===t.i)(q.attempts||[]).forEach(function(a){if(a.t>now-45*DAY)arr.push(a);});});
    var recent=arr.slice(-15), rn=recent.length, ra=rn?recent.filter(function(a){return a.outcome==='right';}).length/rn:null;
    var repeat=0, confidentWrong=0, confidentRight=0, confidenceSum=0, lastAt=0, reasons={};
    recent.forEach(function(a){
      var c=Number(a.conf)||0; confidenceSum+=c; lastAt=Math.max(lastAt,Number(a.t)||0);
      if(a.outcome==='wrong') repeat++;
      if(a.outcome==='wrong'&&c>=3) confidentWrong++;
      if(a.outcome==='right'&&c>=3) confidentRight++;
      if(a.reason) reasons[a.reason]=(reasons[a.reason]||0)+1;
    });
    var calProfile=smAdaptiveCalibration(t.i);
    var calibration=(rn&&confidentWrong+confidentRight)?confidentWrong/Math.max(1,confidentWrong+confidentRight):0;
    if(calProfile.certainAcc!=null && calProfile.certainAcc<.65) calibration=Math.max(calibration,.65);
    var staleDays=lastAt?Math.max(0,(now-lastAt)/DAY):99;
    var observedStability=recent.length?Math.max(3, recent.length>=2 ? Math.min(30, (staleDays||7)+7) : 7):7;
    var retention=lastAt?SM.retentionEstimate(staleDays,observedStability):0;
    var retentionRisk=lastAt?Math.max(0,Math.min(1,1-retention)):1;
    var retentionState=!lastAt?'unknown':(retention<.45?'fragile':(retention<.72?'watch':'stable'));
    var repair=!!((state.repairs||{})[t.i]);
    var stable=(n>=8 && (acc!=null&&acc>=.88) && !dueMap[t.i] && !confidentWrong && repeat===0 && retentionRisk<.7);
    var planned=false, plannedMins=0;
    var r=recFor(date); try{ var sh=shapeToday(plan.byDate[date],date,plan.P,r); sh.shaped.blocks.forEach(function(b){if(b.ti===t.i && ['lunch','buffer','protected'].indexOf(b.kind)<0){planned=true;plannedMins=Math.max(plannedMins,Number(b.mins)||30);}}); }catch(e){}
    var mastery=ra!=null?ra:(acc!=null?acc:(n?Math.min(.75,n/20):.25));
    /* Adaptive Learning Model: recent retrieval, confidence calibration and
       forgetting risk supplement the campaign score without replacing it. */
    var confidenceCalibrationRisk=calibration;
    var reasonKey=Object.keys(reasons).sort(function(a,b){return reasons[b]-reasons[a];})[0]||null;
    out.push({i:t.i,name:t.n,accuracy:ra!=null?ra:acc,mastery:Math.max(0,Math.min(1,mastery)),due:dueMap[t.i]||0,
      repeatMisses:repeat,confidentWrong:confidentWrong>0,recentMiss:repeat>0,repair:repair,planned:planned,plannedMins:plannedMins,
      plannedWeight:planned?7:0,examSoon:examSoon,highYield:(t.yINI>=2||t.yNEET>=2),yieldWeight:5,stable:stable,
      calibrationRisk:confidenceCalibrationRisk,calibrationState:calProfile.state,calibrationCertainAcc:calProfile.certainAcc,retentionRisk:retentionRisk,retention:retention,retentionState:retentionState,daysSinceLastAttempt:staleDays,confidenceGap:Math.abs((rn?confidenceSum/rn:0)/3-(ra==null?.5:ra)),dominantReason:reasonKey,
      family:SM.topicFamily?SM.topicFamily(t.n):t.tr,related:SM.topicRelationIds?SM.topicRelationIds(t.i):[]});
  });
  return out;
}

function smAdaptiveDecision(date,minutes,minimum){
  var e=state.emotionalState||'focused';
  return SM.adaptiveDecision({topics:smAdaptiveTopics(date),minutes:minutes||45,minimum:!!minimum,energy:e,examSoon:(function(){var x=SM.nextExam(plan.P,date);return !!(x&&SM.daysBetween(date,x.iso)<=45);})()});
}

function smAdaptiveQuestions(topicId,action){
  var a=SM.adaptiveQuestionSelect?SM.adaptiveQuestionSelect(Object.keys(state.mcq||{}).map(function(k){return state.mcq[k];}),{topicId:topicId,action:action,limit:6,now:Date.now()}):{items:[],hasEvidence:false};
  return a;
}
function smAdaptiveQuestionCard(topicId,action){
  var a=smAdaptiveQuestions(topicId,action);
  if(!a.hasEvidence) return '<p class="muted sm"><b>Question selection:</b> no exact logged question history for this topic yet. The engine will not invent question identities.</p>';
  var items=a.items||[];
  return '<div class="sm-adq"><div class="row-top"><span class="eyebrow">Best question targets</span><span class="muted sm">'+a.total+' known</span></div>'+items.slice(0,4).map(function(q){
    var meta=(q.subtopic?q.subtopic+' · ':'')+'Q'+q.number+' · '+(q.lastOutcome==='wrong'?'needs repair':q.lastOutcome==='fragile'?'fragile':'review');
    return '<button type="button" class="btn sm sm-adq-item" data-adq="'+esc(String(q.topicId))+'" data-adq-app="'+esc(q.app)+'" data-adq-sub="'+esc(q.subtopic)+'" data-adq-num="'+esc(q.number)+'"><b>'+esc(q.subtopic||q.app||'Question')+'</b><span>'+esc('Q'+q.number)+' · '+esc(q.lastOutcome||'review')+' · '+q.attempts+' attempts</span></button>';
  }).join('')+'<p class="muted sm">'+esc(a.reason)+'</p></div>';
}

function smSessionPlan(date,minutes){
  var requested=Math.max(30,Math.min(240,Number(minutes)||30)); requested=Math.floor(requested/30)*30; if(requested<30) requested=30;
  var topics=smAdaptiveTopics(date), d=smAdaptiveDecision(date,requested,false), energy=state.emotionalState||'focused';
  var inter=SM.adaptiveInterleave?SM.adaptiveInterleave(topics,energy):{enabled:false};
  var target=d.target||{};
  var availableStrategies=inter.enabled?['interleaved','transfer','focused']:['focused','transfer'];
  var strategy=SM.adaptiveStrategyPick?SM.adaptiveStrategyPick((state.adaptive4||{}).strategies,availableStrategies):'focused';
  var difficulty=target.difficulty||{};
  var transfer=target.transferNeed||0;
  /* A learned transfer preference is allowed to raise application work only
     when the topic has enough evidence to support it. Never manufacture
     transfer readiness from an unknown/weak topic. */
  if(strategy==='transfer' && transfer>=.4) transfer=Math.max(transfer,.65);
  var comp=SM.adaptiveSessionCompose?SM.adaptiveSessionCompose({action:d.action,energy:energy,interleaved:inter.enabled,transferNeed:transfer,difficulty:difficulty}):{mins:30,parts:[{mins:10,type:'retrieve',label:'Retrieval'},{mins:10,type:'questions',label:'Questions'},{mins:10,type:'closure',label:'Closure'}]};
  var blocks=[];
  for(var i=0;i<requested/30;i++){
    if(i===0 && inter.enabled) blocks.push({mins:30,label:'Interleaved retrieval · '+inter.topics.map(function(t){return t.name;}).join(' + '),type:'interleave',parts:comp.parts,reason:comp.reason});
    else if(i===0) blocks.push({mins:30,label:(comp.parts||[]).map(function(p){return p.label;}).join(' → '),type:'composed',parts:comp.parts,reason:comp.reason});
    else blocks.push({mins:30,label:i===requested/30-1?'Closed-notes recall · '+(target.name||'today'): 'Adaptive retrieval · '+(target.name||'today'),type:i===requested/30-1?'closure':'retrieval'});
  }
  d.minutes=requested; d.blocks=blocks; d.strategy=strategy; d.composition=comp; d.difficulty=difficulty; d.transferNeed=transfer;
  return {mins:requested,blocks:blocks,decision:d};
}
function smMinimumSession(){
  var d=smAdaptiveDecision(activeDate(),15,true);
  d.blocks=[{mins:Math.min(10,d.minutes),label:d.blocks[0].label,type:d.action},{mins:5,label:'Closed-notes recall · '+d.target.name,type:'closure'}];
  d.minutes=15;
  return {mins:15,blocks:d.blocks,decision:d};
}
function smWeeklyAudit(){
  var since=Date.now()-7*DAY, q=0, correct=0, wrong=0, confWrong=0, types={};
  Object.keys(state.mcq||{}).forEach(function(k){
    var m=state.mcq[k], arr=m&&m.attempts||[];
    arr.forEach(function(a){ if((a.t||0)<since) return; q++; if(a.outcome==="right") correct++; if(a.outcome==="wrong") wrong++; if(a.outcome==="wrong"&&Number(a.conf)>=3) confWrong++; if(a.reason) types[a.reason]=(types[a.reason]||0)+1; });
  });
  var top=Object.keys(types).sort(function(a,b){return types[b]-types[a];})[0];
  return {q:q,acc:q?correct/q:null,wrong:wrong,confWrong:confWrong,top:top?((SM.ERR_TYPES||[]).find(function(e){return e[0]===top;})||[top,top])[1]:null};
}
function smAdaptiveMasteryCard(){
  var rows=smAdaptiveTopics(activeDate()).filter(function(t){return t.accuracy!=null||t.attempts>0;}).sort(function(a,b){return b.priority-a.priority;}).slice(0,4);
  if(!rows.length) return '';
  return card('<div class="row-top"><span class="eyebrow">Evidence, not a guess</span><span class="muted sm">adaptive confidence</span></div>'+rows.map(function(t){var pct=t.accuracy==null?'—':Math.round(t.accuracy*100)+'%';var st=t.retentionState||'unknown';return '<div class="sm-mastery-row"><div><b>'+esc(t.name)+'</b><div class="muted sm">'+pct+' recent accuracy · '+esc(st)+' retention</div></div><span class="badge">'+esc((t.difficulty&&t.difficulty.level)||'unknown')+'</span></div>';}).join(''),"drape");
}
function smAdaptiveStopCard(){
  var a=smAdaptiveTopics(activeDate()).find(function(t){return t.i===(smAdaptiveDecision(activeDate(),30,false).target||{}).i;});
  if(!a) return '';
  var x=SM.adaptiveStopSignal?SM.adaptiveStopSignal({recentAccuracy:a.accuracy,retentionState:a.retentionState,calibrationState:a.calibrationState}):{stop:false};
  return card('<div class="eyebrow">When to stop</div><p class="muted sm">'+esc(x.reason)+'</p>',x.stop?'drape':'');
}
function smRetentionCheckCard(){
  var rows=smAdaptiveTopics(activeDate()).filter(function(t){return t.retentionState==='fragile'||t.retentionState==='watch';}).sort(function(a,b){return b.retentionRisk-a.retentionRisk;}).slice(0,2);
  if(!rows.length) return '';
  return card('<div class="row-top"><span class="eyebrow">Forgetting protection</span><span class="muted sm">quick checks</span></div><p class="muted sm">'+rows.map(function(t){return '<b>'+esc(t.name)+'</b>: retrieve it briefly before relearning.';}).join(' · ')+'</p>',"drape");
}
function smLearningReliabilityCard(){
  var active=state.session&&state.session.date===activeDate();
  var s=active?state.session:smSessionPlan(activeDate(),30), d=s.decision||smAdaptiveDecision(activeDate(),s.mins||45,false), idx=active?Math.min(s.current||0,s.blocks.length-1):0, current=s.blocks[idx];
  var why=(d.reason&&d.reason.length)?d.reason.join(' · '):'This is the highest-value available action from your current evidence.';
  var relatedNote=(d.related&&d.related.length)?'Connected topics: '+d.related.join(' + ')+'. The relationship is used to choose retrieval order, not to change your campaign.':'';
  return card('<div class="row-top"><span class="eyebrow drape">'+(active?'Adaptive session':'Adaptive study engine')+'</span><span class="muted sm">'+s.mins+' min</span></div>'+ 
    '<h2 style="margin:4px 0 6px">'+esc(current?current.label:'Your next useful move')+'</h2>'+ 
    '<p class="muted sm"><b>Why:</b> '+esc(why)+'</p>'+ (relatedNote?'<p class="muted sm">'+esc(relatedNote)+'</p>':'')+ 
    '<div class="lbl">'+s.blocks.map(function(b,i){return '<span style="opacity:'+(active&&i<idx?.55:1)+'">'+esc(b.mins+' min · '+b.label)+'</span>';}).join(' → ')+'</div>'+ 
    smAdaptiveQuestionCard(d.target&&d.target.i,d.action)+'<p class="muted sm">'+(active?'Your session is saved. Finish the current block, then let the engine reassess the next move.':'The engine weighs mastery, retrieval history, confidence calibration, observed retention risk, repeated misses, planned work, exam pressure and today’s energy. Standard sessions are built in 30-minute blocks; stable topics can be skipped and comparable weak topics may be interleaved when that is likely to improve retrieval.')+'</p>'+ 
    '<div class="btnrow">'+(active?'<button class="btn solid f1" data-session-next="1">'+(idx<s.blocks.length-1?'Complete block →':'Complete final block')+'</button><button class="btn sm" data-session-stop="1">Finish session</button>':'<button class="btn solid f1" data-session-start="1">Start this session</button><button class="btn sm" data-minimum-start="1">I only have 15 minutes</button>')+'</div>',"drape");
}
function smRetentionSignal(topicId){
  var t=SM.CURRICULUM[topicId], a=smAdaptiveTopics(activeDate()).find(function(x){return x.i===topicId;});
  if(!t||!a||a.retentionState==='unknown') return '';
  if(a.retentionState==='fragile') return 'Retention is fragile — retrieve before relearning.';
  if(a.retentionState==='watch') return 'Retention is worth a quick retrieval check.';
  return 'Retention looks stable from the available evidence.';
}
function smWeeklyAuditCard(){
  var a=smWeeklyAudit();
  return card('<div class="row-top"><span class="eyebrow">This week</span><span class="muted sm">last 7 days</span></div>'+
    '<div class="g3"><div><div class="big2 drape">'+a.q+'</div><div class="muted sm">logged attempts</div></div>'+
    '<div><div class="big2">'+(a.acc==null?'—':Math.round(a.acc*100)+'%')+'</div><div class="muted sm">accuracy</div></div>'+
    '<div><div class="big2">'+a.confWrong+'</div><div class="muted sm">sure but wrong</div></div></div>'+
    '<p class="muted sm">'+(a.top?'Dominant mistake signal: <b>'+esc(a.top)+'</b>. '+(a.top.toLowerCase().indexOf('forget')>=0?'Use retrieval before adding more input.':'Repair the reasoning, then retrieve it again.'):'Log a few scored questions and this becomes a useful learning signal.')+'</p>',"drape");
}

function renderToday(){
  var date=activeDate(), entry=plan.byDate[date], r=recFor(date), P=plan.P;
  var idx=plan.content.map(function(c){return c.date;}).indexOf(date);
  var st=styleNow(date), nx=SM.nextExam(P,date);
  var out="";
  out+='<div class="sm-v16-brand"><img src="icon.png" alt="Dakshinamurthy app icon"><div><div class="sm-v16-brand-name">Dakshinamurthy</div><div class="sm-v16-brand-sub">Higher Every Hour · Knowledge for Better Surgery</div></div><button type="button" class="sm-v16-brand-mode sm-mode-link" data-go-tab="settings" aria-label="Open visual mode settings">'+(state.visualMode||"focus").toUpperCase()+' MODE</button></div>';
  /* One line, always at the top, regardless of how long the dashboard below
     gets: today's date, the exam countdown, and a way to skip straight past
     target dates / trajectory / Coach to the actual blocks. Opening the app
     to tick off a block should not require scrolling past a feasibility
     report every time. */
  out+='<img class="sm-v22-picture" src="sm-today.svg" alt="Today illustration: mountain, sunrise and winding path">';
  out+='<div class="sm-v25-route"><div class="sm-v25-route-main"><div class="sm-v25-kicker">Today · Your next step</div><div class="sm-v25-title">Climb, don’t chase.</div><div class="sm-v25-copy">One useful block at a time. Your route is already planned; your job is simply to take the next step.</div><div class="sm-v25-badge" style="margin-top:12px">Higher every day</div><div class="sm-v25-route-art"><img src="sm-today.svg" alt=""></div></div><div class="sm-v25-route-side"><div><div class="sm-v25-symbol">ॐ</div><div class="sm-v25-side-title">Learn · Practice · Recover</div><div class="sm-v25-side-copy">Protect sleep. Finish what matters. Let the system carry the rest.</div></div><div class="sm-v25-phase"><div class="sm-v25-phase-dot"></div><div class="sm-v25-phase-line"></div></div></div></div>';
  out+=smIntelligenceCard();
  out+='<div class="jumprow">'+
    '<div class="jumpd">'+esc(SM.pretty(date))+(nx?' &middot; '+Math.max(0,SM.daysBetween(date,nx.iso))+'d to '+esc(SM.STYLES[nx.style].label):'')+'</div>'+
    '<a href="#myday" class="jumplink">My day &darr;</a></div>';
  /* Claude was reachable only from a section partway down the Coach tab —
     rendering correctly but effectively invisible unless you already knew to
     look there. It is now the first action on Today, where the day starts. */
  if(!state.prefs.guideSeen)
    out+=card('<div class="row-top"><span class="eyebrow drape">How this app works</span>'+
      '<button class="btn sm" id="guideHide">Got it</button></div>'+
      '<p class="sm">Two screens, in a loop. That is the whole app.</p>'+
      '<p class="sm"><b>Today</b> → what to do now. Tap Start.</p>'+
      '<p class="sm"><b>Practise</b> → do questions, tap Right / Fragile / Wrong. The ones you get wrong come back here on their own, at the right time.</p>'+
      '<p class="muted sm">Then round again tomorrow. <b>Schedule</b> is only for when something goes wrong — you fall behind, or you want to swap a topic. You can ignore it for weeks.</p>',"drape");
  /* "What should I do now?" — the first thing on the page, above everything
     else. Every other card on Today answers a question you might have; this
     one answers the question you always have. Reads the same shaped blocks
     and the same completion lookup the timeline uses, so it can never
     disagree with the ticks below it. */
  (function(){
    /* shapeToday assumes a real day exists — on a date outside the plan there
       is no entry and it throws on entry.rawItems. The page header below
       already handles that case; the Now card must not crash before reaching
       it. */
    if(!entry){
      out+=card('<div class="eyebrow drape">Do this now</div><p class="lbl">Nothing scheduled for this date.</p>'+
        '<p class="muted sm">This day is outside the plan. Tap Today to go back.</p>',"drape");
      return;
    }
    var f0=shapeToday(entry,date,P,r);
    var wb0=f0.shaped.blocks.filter(function(b){
      return ["lunch","buffer","protected"].indexOf(b.kind)<0; });
    function doneOf(b){
      var sd=b.foldedFrom||date, sk=b.foldedFrom?b.foldedBlockId:b.i;
      var sr=b.foldedFrom?(state.days[sd]||{}):r;
      return (sr.checks||{})[sk];
    }
    var cur=null, nxt=null;
    for(var i=0;i<wb0.length;i++){
      if(doneOf(wb0[i])!==true){ if(!cur) cur=wb0[i]; else { nxt=wb0[i]; break; } }
    }
    var doneCount=wb0.filter(function(b){return doneOf(b)===true;}).length;
    if(!wb0.length){
      out+=card('<div class="eyebrow drape">Do this now</div><p class="lbl">Nothing scheduled today.</p>'+
        '<p class="muted sm">'+esc(head0(entry,idx))+'</p>',"drape");
      return;
    }
    if(!cur){
      /* Surfaced the instant the day is actually complete, rather than a
         button you have to remember to go find in Coach afterwards \u2014 that
         is the honest version of "automatic": the browser will not allow a
         truly silent clipboard write without a tap, but nothing about
         finding this button or building the text requires one now. */
      out+=card('<div class="eyebrow drape">Do this now</div><p class="lbl">Today is done — all '+wb0.length+' blocks.</p>'+
        '<p class="muted sm">Stop here. More today borrows from tomorrow.</p>'+
        '<div class="btnrow" style="margin-top:10px"><button class="btn solid f1" id="cAutoDebrief">'+
        (coachDraft.debriefed?"Copied — now paste":"Get today\u2019s summary from Claude")+'</button></div>',"drape");
      return;
    }
    /* Hourly check-in reminders, honestly scoped: a real calendar file with
       an alarm every hour for the rest of today, which fires even with
       Dakshinamurthy closed \u2014 a browser tab cannot promise more than that. */
    out+=card('<div class="row-top"><span class="muted sm">Hourly check-ins</span></div>'+
      '<p class="muted sm">A calendar reminder every hour for the rest of today, so something can reach you even with the app closed.</p>'+
      '<div class="btnrow"><button class="btn sm" id="hourlyDl">Add hourly reminders</button></div>'+
      '<p class="muted sm" id="hourlyMsg"></p>');
    out+=smLearningReliabilityCard();
    out+=smAdaptiveCalibrationCard();
    out+=smAdaptiveMasteryCard();
    out+=smRetentionCheckCard();
    out+=smAdaptiveStopCard();
    var half=doneOf(cur)===0.5;
    var sk0=streakDays();
    out+=card('<div class="row-top"><span class="eyebrow drape">Do this now</span>'+
      '<span class="muted sm">'+doneCount+' of '+wb0.length+' done'+
        (sk0.n>1?' \u00b7 '+sk0.n+'-day run':'')+'</span></div>'+
      /* "3 of 9" is a fact you have to do arithmetic on; a bar is a glance.
         The whole-syllabus figure moved into the richer Progress section
         below (velocity, projected finish, per-phase, tap-to-jump) rather
         than staying duplicated here in a plainer form. */
      bar(wb0.length?doneCount/wb0.length*100:0,"var(--drape)",5)+
      '<p class="lbl" style="font-size:22.5px;margin:6px 0 2px">'+esc(cur.label)+'</p>'+
      '<p class="muted sm">'+Math.round(cur.mins)+' min'+(cur.detail?' · '+esc(cur.detail):'')+
        (half?' · half done':'')+'</p>'+
      '<div class="btnrow" style="margin-top:12px">'+
        '<button class="btn solid f1" data-jump="myday" style="min-height:50px;font-size:21px">'+
        (half?"Resume this":"Start this")+'</button></div>'+
      (nxt?'<p class="muted sm" style="margin-top:10px">Next: '+esc(nxt.label)+' · '+Math.round(nxt.mins)+' min</p>':
           '<p class="muted sm" style="margin-top:10px">Last block of the day.</p>')+
      /* A bad day needs a number small enough to actually start. Without one,
         "I cannot do seven hours" turns into doing nothing at all. */
      /* Choice, without pretending it is free: the swap is allowed either way,
         but if it jumps a phase the card says so rather than letting you find
         out later from a diagnostic. */
      '<details style="margin-top:10px"><summary class="muted sm" style="cursor:pointer">Work a different topic \u25be</summary>'+
      (function(){
        var all=swapCandidates(date);
        if(!all.length) return '<p class="muted sm" style="margin-top:8px">Nothing else scheduled to swap with.</p>';
        var q=swapQ.trim().toLowerCase();
        var hits=q? all.filter(function(c){ return SM.CURRICULUM[c.ti].n.toLowerCase().indexOf(q)>=0; }) : all;
        /* Show the nearest few by default; searching reaches the rest. Without
           the search the list was capped at eight, which meant a topic further
           out simply could not be chosen from here at all. */
        var cands=hits.slice(0,q?12:8);
        var curPh=Math.max.apply(null,(plan.byDate[date].slots||[]).map(function(x){return SM.CURRICULUM[x.ti].phase;}).concat([0]));
        return '<p class="muted sm" style="margin-top:8px">Pick a topic you would rather do. Today and that day simply trade places \u2014 nothing is lost.</p>'+
          '<textarea id="swapFind" rows="1" aria-label="Search upcoming topics" placeholder="Search all '+all.length+' upcoming topics\u2026"></textarea>'+
          (q?'<p class="muted sm">'+hits.length+' match'+(hits.length===1?'':'es')+'</p>':'')+
          (hits.length?'':'<p class="muted sm">No topic matches that.</p>')+
          '<div class="btnrow" style="flex-wrap:wrap">'+cands.map(function(c){
            var ph=SM.CURRICULUM[c.ti].phase;
            return '<button class="btn sm" data-swap="'+esc(date)+'|0|'+esc(c.d)+'|'+c.i+'">'+
              esc(SM.CURRICULUM[c.ti].n)+(ph>curPh?' \u2197':'')+'</button>';
          }).join("")+'</div>'+
          (!q&&all.length>8?'<p class="muted sm">Showing the next 8 \u2014 search to reach the other '+(all.length-8)+'.</p>':'')+
          '<p class="muted sm">\u2197 means a later phase \u2014 allowed, but you will meet it before the ground it builds on.</p>'+
          ((state.swaps||[]).length?'<div class="btnrow"><button class="btn sm" data-swapclear="1">Undo all swaps</button></div>':'');
      })()+'</details>'+
      '<details style="margin-top:6px"><summary class="muted sm" style="cursor:pointer">Rough day? \u25be</summary>'+
      '<p class="muted sm" style="margin-top:8px">If today is hard, just do <b>this one thing ('+Math.round(cur.mins)+' min)</b>. Nothing else. '+
      'Half of it still counts. A small day is fine. A skipped day is the one that hurts.</p></details>',"drape");
  })();

  /* Secondary context comes after the primary action so Today answers “what now?” first. */
  out+=feasCard(false);
  out+=smCalmTodayCard(entry,date);
  out+=next30Card(30);
  out+=progressSection();
  out+=aiStrip("today");
  /* One compact strip replacing two paragraph-length explainer cards that
     used to sit ABOVE the task. Same information, one line each, and it no
     longer pushes "what do I do now" into third place on the page you open
     twenty times a day. The detail is one tap away. */
  (function(){
    var bits=[], detail=[];
    if(inDiagnostic()){
      var n=state.prefs.diagnosticDays||14, t=todayISO(), done=0;
      for(var i=0;i<plan.content.length;i++){ if(plan.content[i].date<=t) done++; else break; }
      bits.push('Finding your level \u00b7 '+Math.max(1,done)+'/'+n);
      detail.push('These weeks are for learning what you actually remember. Pace and targets stay hidden until there is real data to compute them from. Log every question, right and wrong \u2014 the right ones tell us whether "I knew that" is reliable yet.');
    }
    /* shapeToday throws on a date with no entry — the same guard the Now card
       needs. Second time this exact omission has appeared, so it is worth
       stating: anything calling shapeToday must check entry first. */
    var fr = entry ? shapeToday(entry,date,P,r) : {rampLeft:0};
    if(fr.rampLeft>0){
      bits.push('Easing in \u00b7 '+(P.rampDays-fr.rampLeft+1)+'/'+P.rampDays);
      detail.push('Short days on purpose: about '+(P.rampHours||3)+' hours of questions and the analysis that follows them, no lectures. They resume once the week is done.');
    }
    var logged=Object.keys(state.mcq||{}).length;
    if(!bits.length) return;
    out+=card('<div class="row-top"><span class="muted sm">'+esc(bits.join('  \u00b7  '))+'</span>'+
      '<span class="muted sm">'+logged+' logged</span></div>'+
      '<details style="margin-top:6px"><summary class="muted sm" style="cursor:pointer">Why \u25be</summary>'+
      detail.map(function(d){return '<p class="muted sm" style="margin-top:6px">'+d+'</p>';}).join("")+'</details>');
  })();
  out+=backupReminder();
  out+=trajCard();
  out+=arrearsCard(date);

  out+='<div id="myday"></div>';
  var head = !entry ? "Outside the plan"
    : entry.kind==="content" ? ("Day "+(idx+1)+" of "+plan.content.length)
    : {backup:"Weekly backup",rest:"Rest & repair",mock:"Mock day",mockreview:"Mock review, cold",
       taper:"Taper — "+(entry.exam?SM.STYLES[entry.exam.style].label:""),
       exam:"EXAM DAY",off:"Day off"}[entry.kind]||entry.kind;
  out+='<div class="hd"><div><div class="eyebrow">'+esc(head)+'</div>'+
    '<div class="h1">'+esc(SM.pretty(date))+'</div></div>'+
    '<div class="hdr">'+
    (date!==todayISO()?'<button class="btn sm" data-now="1">Today</button>':'')+
    (nx?'<div class="cd"><div class="cdn'+(SM.daysBetween(date,nx.iso)<0?" rust":"")+'">'+
        Math.max(0,SM.daysBetween(date,nx.iso))+'</div>'+
        '<div class="cdl">'+(SM.daysBetween(date,nx.iso)<0?"date has<br>passed":"days to<br>"+SM.STYLES[nx.style].label)+'</div></div>':'')+
    '</div></div>';
  out+=monthCal(date);

  var loop=SM.loopQueue(state.misses);
  if(loop.length) out+=card('<div class="eyebrow rust">Redo these today &middot; '+loop.length+'</div>'+
    '<p class="muted sm">You were certain and wrong on '+loop.length+' item'+(loop.length===1?"":"s")+
    '. Reading the explanation is the feedback; it is the <b>retrieval afterwards</b> that stops the error returning. Before you finish today.</p>'+
    '<div class="btnrow"><button class="btn solid f1" data-nav="revise">Retrieve '+loop.length+' now</button></div>',"rust");

  var fs=SM.failsafe(state.days,state.misses,Date.now(),state.scores,state.prefs.startISO);
  if(fs.mode!=="normal") out+=card('<div class="eyebrow rust">Fail-safe</div><div class="h2">'+
    esc(fs.head)+'</div><p class="muted sm">'+esc(fs.body)+'</p>',"rust");

  if(!entry){
    out+=card('<div class="h2">Nothing scheduled</div><p class="muted sm">'+
      (date<P.startISO?"The campaign opens on "+esc(SM.pretty(P.startISO))+".":"Past the last exam.")+'</p>');
    return out;
  }

  /* repair sets surface on rest and backup days */
  if(entry.kind==="rest"||entry.kind==="backup"||entry.kind==="taper"){
    var rs=SM.repairSets(state.scores,state.repairs,Date.now(),capDays(),4);
    if(rs.sets.length) out+=card('<div class="eyebrow amber">Topics to redo &middot; '+rs.total+'</div>'+
      rs.sets.map(function(x){
        return '<div class="rs"><div class="row-top"><span class="lbl">'+esc(x.t.n)+'</span>'+
          '<span class="pillq">'+x.take+' q</span></div>'+
          '<div class="muted sm">'+Math.round(x.acc*100)+'% correct so far &middot; '+x.wrong+
          ' wrong in the bank'+(x.sinceDays!=null?" &middot; last repaired "+x.sinceDays+"d ago":" &middot; never repaired")+'</div>'+
          '<div class="btnrow"><button class="btn sm" data-repair="'+x.ti+'">Mark done</button></div></div>';
      }).join("")+
      '<p class="muted sm">Open DocTutorials, filter to <b>previously incorrect</b>, and take these topics mixed together. Before you reveal each answer, say why it is right — otherwise you are recognising the option, not the reasoning.</p>',"amber");
  }

  if(entry.kind!=="content"){
    var sp=SM.specialDay(entry,P);
    out+=card(sp.blocks.map(function(b,i){
      var cv=(r.checks||{})[i], on=(cv===true), half=(cv===0.5);
      return '<div class="chk" data-check="'+i+'" data-mins="'+b.mins+'"><div class="box'+(on?" on":"")+(half?" half":"")+'">'+
        (on?"&#10003;":(half?"&#9680;":""))+'</div><div class="cf"><div class="lbl">'+esc(b.label)+
        (b.mins?' <span class="muted sm">'+b.mins+' min</span>':'')+'</div>'+
        '<div class="muted sm">'+esc(b.note)+'</div></div></div>';
    }).join(""));
    if(entry.kind==="mock"||entry.kind==="taper"||entry.kind==="mockreview"){
      if(mockDraft){
        var mst=SM.STYLES[mockDraft.style]||SM.STYLES.ini;
        var mWrong=Math.max(0,mockDraft.a-mockDraft.c);
        var mNet=mockDraft.c-mWrong*mst.penalty;
        out+=card('<div class="eyebrow amber">Log the mock</div>'+
          '<div class="row-top"><span class="muted sm">questions on the paper</span><span class="btnrow">'+
          [10,-10].map(function(n){ return '<button class="btn sm" data-mq="'+n+'" data-f="q">'+(n>0?"+":"")+n+'</button>'; }).join("")+
          '<span class="num">'+mockDraft.q+'</span></span></div>'+
          '<div class="row-top"><span class="muted sm">you attempted</span><span class="btnrow">'+
          [10,-10,-1].map(function(n){ return '<button class="btn sm" data-mq="'+n+'" data-f="a">'+(n>0?"+":"")+n+'</button>'; }).join("")+
          '<span class="num">'+mockDraft.a+'</span></span></div>'+
          '<div class="row-top"><span class="muted sm">correct</span><span class="btnrow">'+
          [10,-10,-1].map(function(n){ return '<button class="btn sm" data-mq="'+n+'" data-f="c">'+(n>0?"+":"")+n+'</button>'; }).join("")+
          '<span class="num">'+mockDraft.c+'</span></span></div>'+
          (mockDraft.q?'<p class="muted sm">Net '+(Math.round(mNet*10)/10)+' of '+mockDraft.q+
            ' ('+Math.round(mNet/mockDraft.q*100)+'%) after the '+(mst.penalty===0.25?"1/4":"1/3")+
            ' penalty on '+mWrong+' wrong. Raw '+Math.round(mockDraft.c/mockDraft.q*100)+'%.</p>':'')+
          '<div class="btnrow"><button class="btn solid f1" data-mocksave="1">Save</button></div>',"amber");
      } else {
        out+='<div class="btnrow"><button class="btn solid f1" data-mock="'+(entry.exam?entry.exam.style:"ini")+
          '">Log this mock\u2019s score</button></div>';
      }
      out+=attemptCard(st);
    }
    return out;
  }

  /* content day */
  /* Two day shapes, not three tiers. Normal is the plan as built; Empathy sizes
     it to the shorter day. Either way, a large backlog folds its oldest items in
     ahead of new content — both use the same cheap-first cut so Empathy and
     fold-back cannot fight over the same minutes, and both re-run layoutDay so
     gym and the evening off stay pinned to their clock times regardless of what
     shrank to make room. Nothing is dropped from the syllabus; what does not fit
     is redistributed like any other shortfall. Empathy is chosen on the day —
     nothing switches to it on its own. */
  var fold=shapeToday(entry,date,P,r);
  var layer=fold.layer, shaped=fold.shaped;

  var wb=shaped.blocks.filter(function(b){return b.kind!=="lunch"&&b.kind!=="buffer";});
  /* A folded block's completion lives on its origin day, not today's record —
     same lookup timeline() uses, so the ring above the timeline agrees with the
     ticks inside it. */
  var doneN=wb.filter(function(b){
    var sd=b.foldedFrom||date, sk=b.foldedFrom?b.foldedBlockId:b.i;
    var sr=b.foldedFrom?(state.days[sd]||{}):r;
    return (sr.checks||{})[sk]===true; }).length;
  var pct=wb.length?doneN/wb.length*100:0;

  var ct2=callsToday(), d0=todayISO();
  var probe=state.calib.filter(function(x){ return x.d===d0; }), CT=5;
  /* Layers are defined by questions attempted AND reviewed, not by hours —
     hours can be filled without learning; a reviewed question cannot. The
     target now reads off `shaped`, the day actually on screen, so a cut-down
     Empathy day or a fold-in day reports the true count instead of the
     uncut plan's. */
  var planQ=0, foldQ=0;
  wb.forEach(function(x){
    if(!x.items) return;
    if(["bank","image","speed","repass","repass3"].indexOf(x.kind)<0) return;
    var q=x.items.reduce(function(a,e){return a+e.use;},0);
    planQ+=q; if(x.foldedFrom) foldQ+=q;
  });
  var targetQ=planQ;
  /* What that target actually costs today, at this day's mix of first, second
     and third passes — a pass-3 question is roughly half the cost of a pass-1. */
  var mix={p1:0,p2:0,p3:0};
  wb.forEach(function(x){
    if(!x.items) return;
    x.items.forEach(function(e){
      if(x.kind==="bank"||x.kind==="image"||x.kind==="speed") mix.p1+=e.use;
      else if(x.kind==="repass")  mix.p2+=e.use;
      else if(x.kind==="repass3") mix.p3+=e.use; });
  });
  var mixN=Math.max(1,mix.p1+mix.p2+mix.p3);
  var costPerQ = (mix.p1*(P.bankPace + (P.anaPerQ||1.2))
                + mix.p2*(P.bankPace*0.8 + (P.anaPerQ||1.2)*0.5)
                + mix.p3*(P.bankPace*0.7 + (P.anaPerQ||1.2)*0.34)) / mixN;
  var targetMins = Math.round(targetQ*costPerQ);
  var deskMins   = Math.round((layer==="empathy"?(P.empathyHours||7.25):P.dailyHours)*60);
  var fits = targetMins <= deskMins;
  var doneQ = (r.bank||0)+(r.speed||0);
  out+='<div class="dayhd">'+ring(Math.min(100,targetQ?doneQ/targetQ*100:0),
        doneQ+"/"+targetQ,"questions")+
    '<div class="dinfo">'+
      '<div class="lbl">'+targetQ+' questions, every one reviewed</div>'+
      '<div class="muted sm '+(fits?"":"rust")+'">\u2248'+(targetMins/60).toFixed(1)+
        ' h at today\u2019s mix'+(fits?"":" \u2014 more than "+(deskMins/60).toFixed(2).replace(/\.?0+$/,"")+" h")+'</div>'+
      '<div class="muted sm">'+doneN+' of '+wb.length+' blocks &middot; ends '+SM.hhmm(shaped.workEnd%1440)+'</div>'+
      '<div class="seg sm2">'+[["normal","Normal \u00b7 "+P.dailyHours.toFixed(2).replace(".00","")+" h"],
        ["empathy","Empathy \u00b7 "+(P.empathyHours||7.25)+" h"]].map(function(L){
        return '<button class="segb'+(layer===L[0]?" on":"")+'" data-layer="'+L[0]+'">'+L[1]+'</button>'; }).join("")+
      '</div>'+
    '</div></div>';
  if(fold.foldTake.length)
    out+='<p class="muted sm amber">'+fold.foldTake.length+' carried block'+(fold.foldTake.length===1?"":"s")+
      ' folded in first ('+Math.floor(fold.foldMin/60)+'h '+(fold.foldMin%60)+'m'+
      (foldQ?", "+foldQ+" of today\u2019s "+targetQ+" questions":"")+
      ') \u2014 the backlog passed '+FOLD_THRESHOLD+' minutes, so today opens with the oldest debt instead of more new content.</p>';
  if(fold.totalOwed>FOLD_THRESHOLD){
    var wks=Math.max(1,Math.round(fold.totalOwed/FOLD_CAP));
    out+=card('<div class="row-top"><span class="lbl">Clear it faster</span>'+
      '<button class="btn sm'+(P.fastClear?" solid":"")+'" id="cFast">'+(P.fastClear?"On":"Off")+'</button></div>'+
      '<p class="muted sm">At '+FOLD_CAP+' min a day this backlog takes about '+wks+' extra day'+(wks===1?"":"s")+
      ' to clear on top of today. Doubling it to '+(FOLD_CAP*2)+' min clears it roughly twice as fast, at the cost of a longer day for as long as it stays above '+FOLD_THRESHOLD+' minutes. It turns off on its own once the backlog does.</p>',"amber");
  }
  var pct1=Math.round(mix.p1/mixN*100);
  out+='<p class="muted sm mb">'+
    (layer==="empathy"
      ? "<b>Empathy</b> \u2014 "+targetQ+" questions in "+(P.empathyHours||7.25)+" h, every explanation still read. Nothing is written off: the rest goes back into the phase and is redistributed, never doubled onto tomorrow."
      : "<b>Normal</b> \u2014 "+targetQ+" questions, each one reviewed.")+
    ' Today is '+pct1+'% first-pass, which is the expensive kind'+
    (fits?'.':' \u2014 hence the overrun. Later in the campaign, when most questions are second and third pass, the same target costs about half as much.')+
    '</p>';

  /* One strip for the two things logged all day, instead of two full cards. */
  out+='<div class="strip2">'+
    '<button class="chip'+(probe.length>=CT?" done":"")+'" data-panel="cal">'+
      '<span class="chl">Calibration</span><span class="chv">'+probe.length+'/'+CT+'</span></button>'+
    '<button class="chip'+(ct2>P.dayBuffer?" warn":"")+'" data-panel="call">'+
      '<span class="chl">Calls</span><span class="chv">'+Math.floor(ct2/60)+'h '+(ct2%60)+'m</span></button>'+
  '</div>';
  if(panel==="cal"){
    out+=card(probe.length>=CT
      ? '<p class="muted sm drape">Five logged. The curve on Progress is what turns your confidence into an attempt rule.</p>'
      : '<p class="muted sm">Decide how sure you are <i>before</i> you check, then tap what happened.</p>'+
        '<div class="calg">'+[[3,"&#128994;","Certain"],[2,"&#128993;","Unsure"],[1,"&#128308;","Guessed"]].map(function(c){
          return '<div class="calrow"><span class="call">'+c[1]+'<b>'+c[2]+'</b></span>'+
            '<button class="pick calb ok" data-cal="'+c[0]+'" data-ok="1">right</button>'+
            '<button class="pick calb no" data-cal="'+c[0]+'" data-ok="0">wrong</button></div>';
        }).join("")+'</div>');
  }
  if(panel==="call"){
    out+=card('<div class="btnrow">'+[5,10,15,30,-5].map(function(n){
        return '<button class="btn sm" data-call="'+n+'">'+(n>0?"+":"")+n+'m</button>'; }).join("")+'</div>'+
      '<p class="muted sm">'+(ct2<=P.dayBuffer
        ? "Inside the "+P.dayBuffer+"-minute buffer, so the day still ends on time."
        : (ct2-P.dayBuffer)+" min past the buffer \u2014 the day now ends nearer "+
          SM.hhmm((shaped.endMin+ct2-P.dayBuffer)%1440)+". Floor is the better trade than pushing into sleep.")+'</p>');
  }

  out+=allocDonut(shaped.blocks,"Today\u2019s time","Where this day actually goes. Changes if you switch to a shorter day or swap the topic.");
  out+=timeline(shaped.blocks,P,r,date);

  return out;
}

/* Live time-allocation donut. "Live" matters: it is computed from the actual
   blocks in scope \u2014 today's shaped day, or the whole remaining plan \u2014 so it
   moves when you swap a topic, re-plan, or when adaptive analysis shrinks as
   your accuracy data arrives. Not a static pie of intended proportions.
   Drawn with stroke-dasharray on one circle rather than arc paths: fewer
   moving parts, and no risk of a malformed path on a 0% or 100% slice, which
   is exactly the edge case a fresh install and a finished day produce. */
/* Remaining plan, not the whole campaign \u2014 what is already done cannot be
   reallocated, so including it would answer a question nobody is asking. */
function remainingBlocks(){
  var t=todayISO(), out=[];
  plan.content.forEach(function(c){
    if(c.date<t || !c.blocks) return;
    c.blocks.forEach(function(b){ out.push(b); });
  });
  return out;
}
/* Time and questions per topic. Deliberately NOT a 39-slice pie: at that count
   the slices are thinner than their own borders and the legend becomes the
   real chart, which defeats the point. A ranked proportional bar answers the
   same question ("what is eating the time") and stays readable, with a
   phase-coloured donut above it for the coarse split.
   Shows minutes AND question count together because they diverge \u2014 a topic
   can be heavy on lecture time and light on questions, and knowing which is
   the difference between "this is a lot of watching" and "this is a lot of
   practice". */
function topicLoadCard(){
  var B=plan.B, topics=(B.topics||[]).slice();
  if(!topics.length) return "";
  var PH_COL=["","var(--sky)","var(--drape)","var(--amber)","var(--rust)",
              "var(--violet)","#57b7f5","#e08bd0"];
  var totalWork=topics.reduce(function(a,t){return a+t.work;},0);
  var totalQ=topics.reduce(function(a,t){return a+t.dtq+t.spq;},0);
  if(totalWork<=0) return "";

  /* phase donut */
  var byPh={};
  topics.forEach(function(t){ byPh[t.phase]=(byPh[t.phase]||0)+t.work; });
  /* Enlarged from a 118px/52-radius/26-stroke ring to 210px/78-radius/38-stroke
     \u2014 the old size was genuinely hard to read at a glance on a phone. Legend
     rows now carry their own thin bar so the split is visible twice: once in
     the ring, once in the list, since a reader may only look at one. */
  var R=78, C=2*Math.PI*R, off=0;
  var arcs=[1,2,3,4,5,6,7].filter(function(ph){return byPh[ph];}).map(function(ph){
    var len=C*(byPh[ph]/totalWork);
    var seg='<circle cx="105" cy="105" r="'+R+'" fill="none" stroke="'+PH_COL[ph]+'" stroke-width="38"'+
      ' stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'"'+
      ' stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 105 105)"/>';
    off+=len; return seg;
  }).join("");
  var phLegend=[1,2,3,4,5,6,7].filter(function(ph){return byPh[ph];}).map(function(ph){
    var pctv=Math.round(byPh[ph]/totalWork*100);
    return '<div style="margin-top:7px"><div class="row-top"><span class="sm"><span class="caldot" style="display:inline-block;margin-right:6px;background:'+
      PH_COL[ph]+'"></span>'+ph+'. '+esc((SM.PHASE_NAME[ph]||""))+'</span>'+
      '<span class="muted sm" style="font-weight:700">'+pctv+'%</span></div>'+
      bar(pctv,PH_COL[ph],5)+'</div>';
  }).join("");

  /* per-topic bars, heaviest first */
  topics.sort(function(a,b){ return b.work-a.work; });
  var maxW=topics[0].work;
  var bars=topics.map(function(t){
    var q=t.dtq+t.spq;
    return '<div style="margin-top:7px"><div class="row-top">'+
      '<span class="sm">'+esc(t.n)+'</span>'+
      '<span class="muted sm">'+Math.round(t.work/60)+'h \u00b7 '+q.toLocaleString()+'q</span></div>'+
      bar(t.work/maxW*100, PH_COL[t.phase]||"var(--line2)", 6)+'</div>';
  }).join("");

  return card('<div class="eyebrow" style="font-size:21px">Where the syllabus time goes</div>'+
    '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;justify-content:center">'+
    '<svg viewBox="0 0 210 210" width="190" height="190" aria-label="Time split by phase" style="flex-shrink:0">'+arcs+
    '<text x="105" y="98" text-anchor="middle" style="font-size:32.5px;font-weight:800;fill:var(--bone)">'+Math.round(totalWork/60)+'h</text>'+
    '<text x="105" y="124" text-anchor="middle" style="font-size:18.5px;fill:var(--muted)">total, 3 passes</text></svg>'+
    '<div style="flex:1;min-width:220px">'+phLegend+'</div></div>'+
    '<p class="muted sm">'+topics.length+' topics \u00b7 '+totalQ.toLocaleString()+' questions \u00b7 '+
      Math.round(totalWork/60)+'h across all three passes.</p>'+
    '<details style="margin-top:8px"><summary class="muted sm" style="cursor:pointer">Every topic, heaviest first \u25be</summary>'+
    bars+'</details>');
}
function allocDonut(blocks,title,note){
  var by={}, total=0;
  (blocks||[]).forEach(function(b){
    if(["lunch","buffer"].indexOf(b.kind)>=0) return;
    var k = b.kind==="protected" ? "life"
          : (b.kind==="bank"||b.kind==="speed"||b.kind==="image") ? "questions"
          : (b.kind==="repass"||b.kind==="repass3") ? "repeats"
          : (b.kind==="analysis") ? "analysis"
          : (b.kind==="lecture") ? "lectures"
          : "other";
    by[k]=(by[k]||0)+b.mins; total+=b.mins;
  });
  if(total<=0) return "";
  /* Protected gym and wind-down are real time but they are not STUDY time \u2014
     leaving them in the same ring made a 20% slice of "life" compete with the
     thing the chart exists to show. Split out and reported separately, so the
     percentages answer "how is my study time divided" rather than "how is my
     day divided". */
  var lifeMin=by.life||0; delete by.life;
  total-=lifeMin;
  if(total<=0) return "";
  var COL={questions:"var(--sky)",analysis:"var(--drape)",repeats:"var(--amber)",
           lectures:"var(--violet)",life:"var(--line2)",other:"var(--muted)"};
  var order=["questions","analysis","repeats","lectures","other"]
    .filter(function(k){ return by[k]>0; });
  /* Same enlargement as the phase donut: 118px/52-radius/26-stroke was small
     on a phone. Legend rows carry their own bar too, so the split reads even
     if the ring itself is glanced past. */
  var R=78, C=2*Math.PI*R, off=0;
  var arcs=order.map(function(k){
    var frac=by[k]/total, len=C*frac;
    var seg='<circle cx="105" cy="105" r="'+R+'" fill="none" stroke="'+COL[k]+'" stroke-width="38"'+
      ' stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'"'+
      ' stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 105 105)"/>';
    off+=len; return seg;
  }).join("");
  var legend=order.map(function(k){
    var pctv=Math.round(by[k]/total*100);
    return '<div style="margin-top:7px"><div class="row-top"><span class="sm" style="text-transform:capitalize"><span class="caldot" style="display:inline-block;margin-right:6px;background:'+
      COL[k]+'"></span>'+k+'</span><span class="muted sm" style="font-weight:700">'+pctv+'% \u00b7 '+
      Math.floor(by[k]/60)+'h '+Math.round(by[k]%60)+'m</span></div>'+
      bar(pctv,COL[k],5)+'</div>';
  }).join("");
  return card('<div class="eyebrow" style="font-size:21px">'+esc(title)+'</div>'+
    '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;justify-content:center">'+
    '<svg viewBox="0 0 210 210" width="190" height="190" aria-label="Time split by activity" style="flex-shrink:0">'+arcs+
    '<text x="105" y="98" text-anchor="middle" style="font-size:32.5px;font-weight:800;fill:var(--bone)">'+Math.floor(total/60)+'h</text>'+
    '<text x="105" y="124" text-anchor="middle" style="font-size:18.5px;fill:var(--muted)">'+Math.round(total%60)+'m</text></svg>'+
    '<div style="flex:1;min-width:220px">'+legend+'</div></div>'+
    (lifeMin>0?'<p class="muted sm">Plus '+Math.floor(lifeMin/60)+'h '+Math.round(lifeMin%60)+'m protected for gym and winding down, which is not study time and is not counted above.</p>':'')+
    (note?'<p class="muted sm">'+esc(note)+'</p>':''));
}
function timeline(blocks,P,r,date){
  var rows=blocks.map(function(b){ return {at:b.start,b:b}; });
  if(P.gym>P.dayStart) rows.push({at:P.gym,p:{l:"Gym",n:"Fixed. Not a reward for finishing."}});
  if(P.dinner>P.dayStart && !P.dinnerFloat)
    rows.push({at:P.dinner,p:{l:"Family dinner",n:"Fixed."}});
  rows.sort(function(a,b){ return a.at-b.at; });
  var out='<div class="tl">';
  rows.forEach(function(row){
    if(row.p){
      out+='<div class="tr dim"><div class="tt">'+SM.hhmm(row.at)+'</div>'+
        '<div class="tb" style="background:var(--line)"></div><div class="tc">'+
        '<div class="prot">'+esc(row.p.l)+' <span class="muted sm">'+esc(row.p.n)+'</span></div></div></div>';
      return;
    }
    var b=row.b, col=KIND_C[b.kind]||"var(--line2)";
    if(b.kind==="lunch"||b.kind==="buffer"){
      out+='<div class="tr dim"><div class="tt">'+SM.hhmm(b.start)+'</div>'+
        '<div class="tb" style="background:var(--line)"></div><div class="tc">'+
        '<div class="prot">'+icon(b.kind)+' '+esc(b.label)+' <span class="muted sm">'+b.mins+' min</span></div></div></div>';
      return;
    }
    /* A folded-in arrears block carries its OWN origin day and block id — its
       completion state lives there, not on today's record, so it has to be
       looked up and written back separately or ticking it here would silently
       create a phantom entry under today instead of clearing the actual debt. */
    var srcDate=b.foldedFrom||date, srcKey=b.foldedFrom?b.foldedBlockId:b.i;
    var srcRec=b.foldedFrom?(state.days[srcDate]||{}):r;
    var cv=(srcRec.checks||{})[srcKey], on=(cv===true), half=(cv===0.5), exp=(openBlock===b.i);
    if(compact && !exp){
      out+='<div class="tr"><div class="tt">'+SM.hhmm(b.start)+'</div>'+
        '<div class="tb" style="background:'+col+';opacity:'+(on?.35:1)+'"></div>'+
        '<div class="tc"><div class="cmp'+(on?" done":"")+'">'+
        '<div class="box sm2'+(on?" on":"")+(half?" half":"")+'" data-check="'+srcKey+'" data-cdate="'+srcDate+'" data-mins="'+b.mins+
        '" style="'+(on?"background:"+col+";border-color:"+col:(half?"border-color:"+col:""))+'">'+(on?"&#10003;":(half?"&#9680;":""))+'</div>'+
        '<span class="cmpl" data-open="'+b.i+'">'+esc(b.head||b.label)+
        (b.topic?' <span class="muted">&middot; '+esc(clip(b.topic,40))+'</span>':'')+'</span>'+
        '<span class="muted sm">'+b.mins+'m</span></div></div></div>';
      return;
    }
    var inner='<div class="bh"><div class="box'+(on?" on":"")+(half?" half":"")+'" data-check="'+srcKey+'" data-cdate="'+srcDate+'" data-mins="'+b.mins+
      '" style="'+(on?"background:"+col+";border-color:"+col:(half?"border-color:"+col:""))+'">'+(on?"&#10003;":(half?"&#9680;":""))+'</div>'+
      '<div class="bt" data-open="'+b.i+'"><div class="lbl'+(on?" struck":"")+'">'+
      icon(b.kind,col)+' '+esc(b.head||b.label)+(b.foldedFrom?' <span class="amber sm">&middot; carried</span>':'')+'</div>'+
      (b.topic?'<div class="btop" style="color:'+col+'">'+esc(b.topic)+'</div>':'')+
      /* Clock checkpoints every 20 minutes across the block. A block can be an
         hour or more, and "did I start this at the right time" is not the same
         question as "am I still on time thirty minutes in". Shows the wall
         time you should be at each mark, so drift is visible before the block
         ends rather than after. */
      (b.mins>=25 ? '<div class="ticks">'+(function(){
        var out2=[], m=20;
        while(m<b.mins){ out2.push('<span class="tick">'+SM.hhmm((b.start+m)%1440)+'</span>'); m+=20; }
        return out2.join("");
      })()+'</div>' : '')+
      '<div class="meta"><span>'+SM.hhmm(b.start%1440)+'\u2013'+SM.hhmm((b.start+b.mins)%1440)+' \u00b7 '+b.mins+' min</span>'+
      (b.detail?'<span>'+esc(b.detail)+'</span>':"")+
      (b.items&&b.items.length?'<span>'+(b.items.length>1?b.items.length+' items':esc(clip(b.items[0].item[0],64)))+'</span>':"")+
      '</div></div>'+
      '<div class="chev'+(exp?" up":"")+'" data-open="'+b.i+'">&#8250;</div></div>';
    if(exp){
      inner+='<div class="bd">';
      if(b.items && b.items.length){
        var kk={lecture:"l",bank:"b",speed:"s",image:"b",repass:"b"}[b.kind];
        inner+='<div class="eyebrow" style="margin:0 0 7px">Open exactly this</div>'+
          b.items.map(function(e){
            var L=SM.itemLine(e,kk);
            /* Lectures get a persistent watched marker of their own. Ticking
               the block marks the day done; this records WHICH of the 679
               lectures have actually been watched, which nothing tracked
               before — so a re-plan or a gap left no way to tell. */
            var lk = b.kind==="lecture" ? (e.item[0]+"|"+e.item[2]) : null;
            var seen = lk && state.lecDone && state.lecDone[lk];
            return '<div class="srcitem"><div class="srcn">'+
              (lk?'<button class="btn sm" data-lec="'+esc(lk)+'" style="margin-right:8px">'+(seen?"&#10003;":"\u25cb")+'</button>':'')+
              esc(L.name)+'</div>'+
              '<div class="srcq" style="color:'+col+'">'+esc(L.qty)+'</div>'+
              '<div class="srcp">'+esc(L.where)+'</div></div>';
          }).join("");
      }
      inner+='<p class="muted sm">'+esc(b.note||"")+'</p>';
      if(["bank","speed","image","repass"].indexOf(b.kind)>=0){
        var running=timer&&timer.blockId===date+"#"+b.i;
        var el=running?timerElapsed():0;
        inner+='<div class="timer"><span class="tclock">'+
          String(Math.floor(el/60)).padStart(2,"0")+':'+String(el%60).padStart(2,"0")+'</span>'+
          '<button class="btn sm" data-timer="'+b.i+'">'+(running&&timer.running?"Pause":running?"Resume":"Start")+'</button>'+
          (running?'<button class="btn sm solid" data-timerstop="'+b.i+'" data-ti="'+(b.ti==null?"":b.ti)+'">Log &amp; stop</button>':"")+
          '</div>';
        if(b.ti!=null){
          var pc2=paceFor(b.ti), tgt=SM.paceTarget(styleNow(date));
          if(pc2.q>0){
            var per=Math.round(pc2.sec/pc2.q);
            inner+='<div class="muted sm">Your pace on this topic: <b class="'+(per>tgt*1.15?"rust":per<=tgt?"drape":"amber")+
              '">'+per+' s a question</b> against '+tgt+' s allowed in '+styleNow(date).label+'.</div>';
          }
        }
      }
      if(b.kind==="bank"||b.kind==="speed"||b.kind==="image"||b.kind==="repass"){
        var src=(b.kind==="speed")?"speed":"bank";
        var af=(b.kind==="speed")?"sa":"ba", cf=(b.kind==="speed")?"sc":"bc";
        var sc=b.ti!=null?scoreFor(b.ti):null;
        inner+='<div class="scorebox"><div class="row-top"><span class="muted sm">attempted</span>'+
          '<span class="btnrow">'+[10,25,-10].map(function(n){
            return '<button class="btn sm" data-bump="'+src+'" data-n="'+n+'" data-ti="'+
              (b.ti==null?"":b.ti)+'" data-f="'+af+'">'+(n>0?"+":"")+n+'</button>'; }).join("")+
          '<span class="num">'+(sc?sc[af]:(r[src]||0))+'</span></span></div>';
        if(sc) inner+='<div class="row-top"><span class="muted sm">correct</span>'+
          '<span class="btnrow">'+[10,25,-10].map(function(n){
            return '<button class="btn sm" data-score="'+b.ti+'" data-f="'+cf+'" data-n="'+n+'">'+
              (n>0?"+":"")+n+'</button>'; }).join("")+
          '<span class="num" style="color:'+accColour(sc[af]?sc[cf]/sc[af]:null)+'">'+sc[cf]+'</span></span></div>'+
          (sc[af]>=10?'<div class="muted sm">'+Math.round(sc[cf]/sc[af]*100)+'% on this topic'+
            (b.kind==="speed"?" under a clock":"")+'</div>':'');
        inner+='</div>';
        if(b.kind==="speed") inner+='<p class="muted sm">Target pace '+SM.paceTarget(styleNow(date))+
          ' s a question — that is what '+styleNow(date).label+' allows.</p>';
      }
      if(b.kind==="analysis"&&b.ti!=null){
        var tl=tallyFor(b.ti);
        inner+='<div class="eyebrow" style="margin:10px 0 6px">Tally the misses — one tap each</div>'+
          '<div class="g2">'+SM.ERR_TYPES.map(function(e){
            return '<button class="pick tal" data-tally="'+b.ti+'" data-k="'+e[0]+'">'+e[1]+
              '<span class="tn">'+(tl[e[0]]||0)+'</span></button>'; }).join("")+'</div>'+
          '<div class="btnrow"><button class="btn sm" data-nav="log">Write up a certain-and-wrong one</button>'+
          '<button class="btn sm" data-untally="'+b.ti+'">Undo</button></div>';
      }
      inner+='</div>';
    }
    out+='<div class="tr"><div class="tt">'+SM.hhmm(b.start)+'</div>'+
      '<div class="tb" style="background:'+col+';opacity:'+(on?.35:1)+'"></div>'+
      '<div class="tc"><div class="blk'+(on?" done":"")+(exp?" exp":"")+'">'+inner+'</div></div></div>';
  });
  return out+'</div>';
}

function attemptCard(st){
  var r=SM.attemptRule(state.calib,st);
  var names={3:"&#128994; Certain",2:"&#128993; Unsure",1:"&#128308; Guessed"};
  return card('<div class="eyebrow amber">'+st.label+' attempt rule</div>'+
    '<p class="muted sm">Penalty is '+(st.penalty===0.25?"a quarter":"a third")+
    ' of a mark, so a blind guess is worth <b>'+(SM.blindEV(st)>0.001?"+"+SM.blindEV(st).toFixed(2)+" — attempt everything":"exactly zero — a blank costs nothing")+
    '</b>. Break even at '+Math.round(SM.breakEven(st)*100)+'% accuracy.</p>'+
    r.levels.map(function(l){
      return '<div class="row-top"><span class="sm">'+names[l.conf]+'</span><span class="sm '+
        (l.verdict==="attempt"?"drape":l.verdict==="skip"?"rust":"muted")+'">'+
        (l.p===null?"no data yet":Math.round(l.p*100)+"% right &rarr; "+l.verdict)+'</span></div>'; }).join(""),"amber");
}


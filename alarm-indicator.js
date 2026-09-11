(function(){
  'use strict';
  document.addEventListener('DOMContentLoaded',function(){
    const obsolete=document.querySelector('#eventsCard');
    if(obsolete)obsolete.remove();
    const bar=document.querySelector('#alarmBar');
    if(!bar)return;
    bar.className='alarm-bar alarm-indicator-bar';
    bar.hidden=false;
    bar.innerHTML='<button class="alarm-indicator" id="alarmIndicator" type="button"><span>Alarms</span> <span class="alarm-indicator-count">(0)</span></button>';
    const button=bar.querySelector('#alarmIndicator');
    button.addEventListener('click',function(){document.querySelector('[data-tab="logbook"]')?.click()});
    button.setAttribute('aria-label','Alarms, 0 active. Open Events.');

    renderAlarmBar=function(){
      const market=typeof openAlerts!=='undefined'&&Array.isArray(openAlerts)?openAlerts:[];
      const staff=typeof staffHelpAlerts!=='undefined'&&Array.isArray(staffHelpAlerts)?staffHelpAlerts:[];
      const marketOpen=market.filter(function(item){return item&&item.state!=='cleared'});
      const staffOpen=staff.filter(function(item){return item&&item.needsHelp&&item.helpState!=='resolved'});
      const total=marketOpen.length+staffOpen.length;
      const unacknowledged=marketOpen.filter(function(item){return item.state==='active'}).length+
        staffOpen.filter(function(item){return item.helpState==='requested'}).length;
      button.querySelector('.alarm-indicator-count').textContent='('+total+')';
      button.classList.toggle('has-alarms',total>0);
      button.classList.toggle('unacknowledged',unacknowledged>0);
      button.setAttribute('aria-label','Alarms, '+total+' active, '+unacknowledged+' unacknowledged. Open Events.');
      button.title=unacknowledged?unacknowledged+' unacknowledged alarm'+(unacknowledged===1?'':'s'):'Open Events';
    };
    renderAlarmBar();
  });
})();

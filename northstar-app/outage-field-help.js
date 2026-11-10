// Delegated so regenerated forms, switching rows and the library share one popup.
(() => {
  'use strict';
  const hints={
    query:'Search the outage register by name, site, equipment or ID.',
    type:'Limit the register to planned or unplanned outages.',status:'Show only outages at this stage of review.',
    from:'Include outages starting on or after this date.',until:'Include outages starting through this date.',
    title:'Use a name crews will recognize in the outage register.',site:'Enter the primary station or facility affected.',
    asset:'Choose equipment from the selected sites or type your own reference.',equipment:'Choose a site device or enter a different equipment reference.',start:'Enter the planned start in local time.',
    end:'Enter the planned finish in local time, after the start.',scope:'Describe the work and the equipment or sites it covers.',
    severity:'Choose the planning priority for this outage.',reviewTrigger:'Choose why review is needed. This sets the review requirements.',
    additional:'List every other affected site, one per line.',affectedSites:'List additional affected sites, one per line.',
    sscLead:'Choose the scheduled SSC who will coordinate the outage from the control room.',
    localLead:'Choose the field contact who will coordinate the crews and stay in touch with the SSC.',
    recipient:'Choose the person who should receive this outage link in their Inbox.',
    tagNote:'Tell the recipient what needs their attention. The note also appears in the outage event log.',
    reportChoice:'Choose the outage whose signatures, pending work, switching log and closeout you want to see.',
    bookQuery:'Search the selected UWPC section by keyword.',pageNumber:'Enter the PDF page number to open.',
    readMode:'Switch between the original PDF and the text of the selected page.',
    outageId:'Identifies the outage that this document belongs to.',authority:'Enter the name of the controlling authority.',
    reference:'Enter the reference number used by the authority or permit.',diagramRevision:'Identify the drawing revision used to prepare this package.',
    kind:'Choose the type of package being prepared.',template:'Choose the UWPC form for this document.',
    description:'Give a short description of the work for the plan list.',notes:'Add context or open questions for the next person reviewing the package.',
    purpose:'Describe what this switching order is intended to accomplish.',serialNo:'Enter the serial number of this order.',
    pc3TagNo:'Enter the PC3 tag number referenced by the form, if applicable.',agentCopy:'Select if this is the agent’s copy of the order.',
    device:'Identify the device for this sequence line.',removeTag:'Enter the tag number listed for removal on this line.',
    operation:'Record the planned operation for this sequence line.',placeTag:'Enter the tag number listed for placement on this line.',
    lockNo:'Enter the lock number associated with this line.',orderedBy:'Identify the person who ordered this step.',
    completedBy:'Identify who completed the activity recorded here.',preparedBy:'Identify who prepared the order.',
    preparedAt:'Enter when the order was prepared.',checkedBy:'Identify who checked the order.',checkedAt:'Enter when the check took place.',
    completedAt:'Enter when the sequences were completed.',preparer:'Choose the person who prepared this revision.',
    due:'Enter the deadline for reviewing this revision.',checker:'Choose the qualified person responsible for the independent accuracy check.',
    area:'Choose the area manager assigned to review this outage.',scheduled:'Select each SSC scheduled during the outage.',
    copyTo:'Send this person the final copy for information. No signature is required.',
    summary:'Describe what changed since the previous revision.',confirmed:'Confirm the statement after completing the review it describes.',
    comment:'Record the correction or response for this review.',uwpcReviewer:'Assign this operator to review the current revision.',
    occurredAt:'Enter the local time when the activity or exchange took place.',step:'Link this entry to a switching step or record a general handoff.',
    direction:'Choose whether the correspondence was sent to or received from the authority.',
    message:'Record the exchange with the authority. This entry does not send a message.',
    uwpcSourceKind:'Identify whether the attachment is a diagram or supporting document.',uwpcSourceUpload:'Choose a source file to attach to this revision.',
    uwpcDecisionComment:'Explain your decision or the changes needed.',uwpcReviewed:'Confirm you have reviewed the listed materials.',
    uwpcPlanPhase:'Choose the lifecycle status to record for this plan.'
  };
  function explanation(el){
    if(el.dataset.help)return el.dataset.help;
    if(el.id==='site')return 'Show outages affecting the selected site.';
    if(el.id==='severity')return 'Show only outages with the selected priority.';
    if(el.closest('.document-select'))return 'Choose the package document to display in this folder.';
    if(el.hasAttribute('data-field-site'))return 'Choose the on-site reviewer for this location.';
    if(el.name==='site' && el.tagName==='SELECT')return 'Choose the site where this activity took place.';
    if(el.name==='text'){
      const context=el.closest('label')?.textContent.trim()||'';
      return ({Concern:'Explain what the outage managers should check in the final copy.',Resolution:'Record how this concern was addressed.',
        'Closing summary':'Describe the outcome and any remaining work at closure.','Follow-up note':'Record new information or follow-up after closure.',
        'Activity or handoff':'Describe what happened or what was handed over.'})[context]||'Describe the activity for the outage record.';
    }
    return hints[el.dataset.stepField||el.dataset.planField||el.name||el.id]||el.placeholder;
  }
  const selector='input:not([type=hidden]),select,textarea';
  const field=node=>node?.closest?.(selector)||node?.closest?.('label')?.control;
  const tip=document.createElement('div');tip.id='outageFieldHelp';tip.setAttribute('role','tooltip');tip.hidden=true;
  document.body.append(tip);
  let active,timer;
  function hide(){
    clearTimeout(timer);
    if(active){
      const ids=(active.getAttribute('aria-describedby')||'').split(/\s+/).filter(s=>s && s!==tip.id);
      if(ids.length)active.setAttribute('aria-describedby',ids.join(' '));else active.removeAttribute('aria-describedby');
    }
    tip.hidden=true;active=null;
  }
  function show(el){
    if(!el?.isConnected || !el.getClientRects().length || el.getAttribute('aria-expanded')==='true')return hide();
    const msg=explanation(el);if(!msg)return hide();
    hide();active=el;tip.textContent=msg;
    el.setAttribute('aria-describedby',[el.getAttribute('aria-describedby'),tip.id].filter(Boolean).join(' '));
    (document.fullscreenElement||document.body).append(tip);
    tip.hidden=false;
    const b=el.getBoundingClientRect(), gap=4;
    tip.style.left=Math.max(6,Math.min(b.left,innerWidth-tip.offsetWidth-6))+'px';
    tip.style.top=Math.max(4,b.bottom+gap+tip.offsetHeight<=innerHeight?b.bottom+gap:b.top-tip.offsetHeight-gap)+'px';
  }
  document.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch')return;
    if(e.target===tip){clearTimeout(timer);return;}
    const el=field(e.target);if(!el||field(e.relatedTarget)===el)return;
    clearTimeout(timer);timer=setTimeout(()=>show(el),350);
  });
  document.addEventListener('pointerout',e=>{
    if((e.target===tip || field(e.target)) && e.relatedTarget!==tip && (!field(e.relatedTarget)||field(e.relatedTarget)!==field(e.target))){
      clearTimeout(timer);timer=setTimeout(hide,100);
    }
  });
  document.addEventListener('focusin',e=>{if(e.target.matches(selector) && e.target.matches(':focus-visible'))show(e.target);});
  document.addEventListener('focusout',hide);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
  for(const event of ['input','change','pointerdown','scroll'])document.addEventListener(event,hide,true);
  for(const event of ['blur','resize','hashchange','pagehide'])window.addEventListener(event,hide);
})();

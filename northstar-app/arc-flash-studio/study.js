const titles={yard:'Open-air multiphase bus',enclosed:'Enclosed transmission bus',sources:'Multiple-source fault'};
const key=new URLSearchParams(location.search).get('scenario');
const scenario=titles[key] || titles.yard;
document.querySelector('#name').textContent=scenario;
document.querySelector('#study').addEventListener('submit',event=>{
 event.preventDefault();
 const inputs=Object.fromEntries(new FormData(event.currentTarget));
 const file=new Blob([JSON.stringify({scenario,status:'Unverified inputs — external study required',inputs},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(file), a=document.createElement('a');
 a.href=url;a.download='arc-flash-study-inputs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

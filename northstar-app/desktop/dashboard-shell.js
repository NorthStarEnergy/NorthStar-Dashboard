document.getElementById('menu').addEventListener('click',()=>window.northstarWindow.openMenu());
document.addEventListener('keydown',event=>{if(event.key==='F10'){event.preventDefault();window.northstarWindow.openMenu();}});

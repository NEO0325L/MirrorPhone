'use strict';
// Layout is independent of signaling: rotation and decoded size must never crop the picture.
(()=>{
  const screen=document.getElementById('screen'),video=document.getElementById('video');
  const button=document.getElementById('fullscreen'),exit=document.getElementById('exitFullscreen');
  const main=screen.closest('main');
  let scheduled=false;
  const nativeFullscreen=()=>document.fullscreenElement===screen||document.webkitFullscreenElement===screen;
  const expanded=()=>nativeFullscreen()||document.body.classList.contains('viewer-expanded');
  function layout(){
    scheduled=false;
    if(expanded())return;
    const bodyStyle=getComputedStyle(document.body);
    const padding=parseFloat(bodyStyle.paddingTop)+parseFloat(bodyStyle.paddingBottom);
    const chrome=main.getBoundingClientRect().height-screen.getBoundingClientRect().height+padding;
    const viewport=window.visualViewport?.height||window.innerHeight;
    screen.style.setProperty('--viewer-height',`${Math.max(240,Math.floor(viewport-chrome))}px`);
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(layout);}}
  function sync(){
    const active=expanded();
    button.textContent=active?'Salir de pantalla completa':'Pantalla completa';
    button.setAttribute('aria-pressed',String(active));
    exit.hidden=!active;
    document.getElementById('fullscreenSound').hidden=!active;
    schedule();
  }
  async function leave(){
    document.body.classList.remove('viewer-expanded');
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.webkitFullscreenElement)document.webkitExitFullscreen();
    sync();
  }
  async function enter(){
    if(expanded()){await leave();return;}
    try{
      if(screen.requestFullscreen&&document.fullscreenEnabled){await screen.requestFullscreen();}
      else if(screen.webkitRequestFullscreen){screen.webkitRequestFullscreen();}
      else document.body.classList.add('viewer-expanded');
    }catch{
      // Embedded browsers may disallow OS fullscreen. Fill their viewport instead.
      document.body.classList.add('viewer-expanded');
    }
    sync();
  }
  button.addEventListener('click',enter);
  exit.addEventListener('click',leave);
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('webkitfullscreenchange',sync);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('viewer-expanded'))leave();});
  window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  video.addEventListener('loadedmetadata',schedule);
  video.addEventListener('resize',schedule);
  // Measure the space occupied by controls rather than hardcoding a video height.
  const observer=new ResizeObserver(schedule);
  for(const element of main.children)if(element!==screen)observer.observe(element);
  sync();
})();

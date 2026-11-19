/*
 * Moteur d'affichage des cockpits DashLink : seul script exécuté dans la WebView d'un cockpit (injecté par
 * l'appli ; la CSP interdit tout script du module). Filtre par liste blanche : balises d'affichage (HTML et
 * SVG), attributs sans gestionnaire d'événement ni adresse ; `src` seulement sur `img` vers un fichier du
 * paquet ou une image `data:` ; `<link>` seulement pour une feuille de style du paquet. Le parseur d'un
 * `template` est inerte : rien ne se charge avant le filtre. Les appuis sur [data-tap] remontent à la logique.
 * Sur l'écran de la moto, la position de la zone [data-dl="carte"] est remontée : DashLink y dessine le guidage.
 * Copie identique dans le kit (kit/tools/cockpit-runtime.js), vérifiée par les tests de l'appli.
 */
(()=>{
const TAGS=new Set('div span p b i u s em strong small sub sup br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr td th caption section article header footer main nav aside figure figcaption label button img progress meter code pre blockquote mark time style link svg g path circle rect line polyline polygon ellipse text tspan defs lineargradient radialgradient stop clippath title'.split(' '));
const DROP=new Set(['href','xlink:href','src','srcset','srcdoc','action','formaction','ping','poster','background','data','codebase','manifest','http-equiv','form','target','download','lowsrc','dynsrc','autofocus','contenteditable','is']);
const LOCAL=/^(?!.*\.\.)[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.[A-Za-z0-9]+$/;
const IMG=/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
function clean(node){
  for(const el of Array.from(node.querySelectorAll('*'))){
    const t=el.localName.toLowerCase();
    if(!TAGS.has(t)){el.remove();continue}
    const src=el.getAttribute('src'),href=el.getAttribute('href'),rel=(el.getAttribute('rel')||'').toLowerCase();
    for(const a of Array.from(el.attributes)){const n=a.name.toLowerCase();if(n.startsWith('on')||DROP.has(n)||n.startsWith('xmlns:'))el.removeAttribute(a.name)}
    if(t==='img'&&src&&(LOCAL.test(src)||IMG.test(src)))el.setAttribute('src',src);
    if(t==='link'){if(rel==='stylesheet'&&href&&LOCAL.test(href)&&href.endsWith('.css')){for(const a of Array.from(el.attributes))el.removeAttribute(a.name);el.setAttribute('rel','stylesheet');el.setAttribute('href',href)}else el.remove()}
  }
  return node;
}
const app=document.getElementById('dl-app');
const byId=id=>{const e=document.getElementById(id);return e&&app.contains(e)?e:null};
let zone='';
const mapZone=()=>{const e=app.querySelector('[data-dl="carte"]'),r=e?e.getBoundingClientRect():null,
  v=r&&r.width>0&&r.height>0?[r.left,r.top,r.width,r.height].map(Math.round):[0,0,0,0],k=v.join();
  if(k!==zone){zone=k;DashLinkUi.map(v[0],v[1],v[2],v[3])}};
const later=()=>requestAnimationFrame(mapZone);
addEventListener('resize',later);
window.__dlui={apply(o){
  if(o.op==='html'){const t=document.createElement('template');t.innerHTML=o.html;app.replaceChildren(clean(t.content))}
  else{const e=byId(o.id);if(!e)return;
    if(o.op==='text')e.textContent=o.text;
    else if(o.op==='class')e.classList.toggle(o.name,o.on);
    else if(o.op==='style')e.style.setProperty(o.prop,o.value)}
  later();
}};
document.addEventListener('click',ev=>{const t=ev.target&&ev.target.closest?ev.target.closest('[data-tap]'):null;if(t&&app.contains(t))DashLinkUi.tap(String(t.getAttribute('data-tap')).slice(0,64))},true);
})()

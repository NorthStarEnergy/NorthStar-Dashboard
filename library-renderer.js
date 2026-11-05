/* Curated, shared research snapshots. Source files live in research/projects. */
(() => {
  'use strict';
  const catalog = window.NorthstarResearchCatalog;
  let sharedReader = false;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = url => /^https?:\/\//i.test(url) ? url : '';
  const fileLink = (label, url, project) => {
    const file = project.files.find(f => f.name === url);
    if (file) return '<button type="button" class="research-inline-file" data-research-file="'+esc(file.name)+'">'+label+'</button>';
    return safeUrl(url) ? '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>' : label+' <span class="research-reference">('+esc(url)+')</span>';
  };
  function inline(text, project) {
    const tokens=[];
    const token = html => '\u0000'+(tokens.push(html)-1)+'\u0000';
    text = text.replace(/`([^`]+)`/g, (_,v)=>token('<code>'+esc(v)+'</code>'));
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(_,label,url)=>token(fileLink(esc(label),url,project)));
    return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]);
  }
  function markdown(text, project) {
    const lines=text.replace(/\r/g,'').split('\n'); let html='',list='',code=null;
    const close=()=>{if(list){html+='</'+list+'>';list='';}};
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];
      if(/^```/.test(line)){close();if(code!==null){html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';code=null;}else code=[];continue;}
      if(code!==null){code.push(line);continue;}
      if(!line.trim()){close();continue;}
      if(line.startsWith('|') && /^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')) {
        close();const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
        html+='<div class="research-table"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c,project)+'</th>').join('')+'</tr></thead><tbody>';i++;
        while((lines[i+1]||'').startsWith('|'))html+='<tr>'+cells(lines[++i]).map(c=>'<td>'+inline(c,project)+'</td>').join('')+'</tr>';
        html+='</tbody></table></div>';continue;
      }
      const heading=/^(#{1,6})\s+(.+)/.exec(line);
      if(heading){close();const n=Math.min(heading[1].length+1,6);html+='<h'+n+'>'+inline(heading[2],project)+'</h'+n+'>';continue;}
      const item=/^\s*(?:([-*])|\d+[.)])\s+(.+)/.exec(line);
      if(item){const tag=item[1]?'ul':'ol';if(list!==tag){close();list=tag;html+='<'+tag+'>';}html+='<li>'+inline(item[2],project)+'</li>';continue;}
      close();html+=line.startsWith('>')?'<blockquote>'+inline(line.replace(/^>\s?/,''),project)+'</blockquote>':'<p>'+inline(line,project)+'</p>';
    }
    close();if(code!==null)html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';return html;
  }

 window.NorthstarLibraryRender = markdown;
})();

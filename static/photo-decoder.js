/* Local, bounded barcode photo enhancement. The source canvas is never modified. */
(() => {
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  function gray(image) {
    const p = image.data, values = new Uint8Array(p.length / 4);
    for (let i = 0; i < values.length; i++) values[i] = Math.round(.299 * p[i*4] + .587 * p[i*4+1] + .114 * p[i*4+2]);
    return values;
  }
  function stretch(g) {
    const hist = new Uint32Array(256); for (const v of g) hist[v]++;
    let low = 0, high = 255, n = 0;
    while (low < 254 && (n += hist[low]) < g.length * .02) low++;
    n = 0; while (high > low && (n += hist[high]) < g.length * .02) high--;
    const range = Math.max(1, high-low);
    return Uint8Array.from(g, (v) => Math.max(0, Math.min(255, Math.round((v-low)*255/range))));
  }
  function otsu(g) {
    const hist = new Uint32Array(256); let sum=0;
    for (const v of g) { hist[v]++; sum+=v; }
    let count=0, partial=0, best=-1, threshold=127;
    for(let t=0;t<255;t++) { count+=hist[t]; partial+=t*hist[t]; if(!count||count===g.length)continue;
      const d=partial/count-(sum-partial)/(g.length-count), variance=count*(g.length-count)*d*d;
      if(variance>best){best=variance;threshold=t;}
    }
    return threshold;
  }
  function adaptive(g,w,h) {
    const stride=w+1, integral=new Float64Array(stride*(h+1)), out=new Uint8Array(g.length);
    for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=g[y*w+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}}
    const radius=Math.max(8,Math.min(30,Math.round(Math.min(w,h)/16)));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const l=Math.max(0,x-radius),r=Math.min(w,x+radius+1),t=Math.max(0,y-radius),b=Math.min(h,y+radius+1);
      const mean=(integral[b*stride+r]-integral[t*stride+r]-integral[b*stride+l]+integral[t*stride+l])/((r-l)*(b-t));
      out[y*w+x]=g[y*w+x]<mean-8?0:255;
    }
    return out;
  }
  function deskew(c) {
    const g=gray(c.getContext('2d').getImageData(0,0,c.width,c.height)),w=c.width,h=c.height;
    let xx=0,yy=0,xy=0;
    for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const i=y*w+x,gx=g[i+1]-g[i-1],gy=g[i+w]-g[i-w];if(gx*gx+gy*gy<900)continue;xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;}
    return xx+yy ? -.5*Math.atan2(2*xy,xx-yy)*180/Math.PI : 0;
  }
  function filter(c, mode) {
    if(mode==='color')return;
    const ctx=c.getContext('2d'),image=ctx.getImageData(0,0,c.width,c.height),w=c.width,h=c.height;
    let g=gray(image);
    if(mode!=='gray')g=stretch(g);
    if(mode==='sharpen'){
      const original=g;g=new Uint8Array(g);
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;g[i]=Math.max(0,Math.min(255,Math.round(original[i]*2-(original[i-1]+original[i+1]+original[i-w]+original[i+w])/4)));}
    }else if(mode==='binary'){const threshold=otsu(g);g=Uint8Array.from(g,(v)=>v>threshold?255:0);}
    else if(mode==='adaptive')g=adaptive(g,w,h);
    else if(mode==='invert')g=Uint8Array.from(g,(v)=>255-v);
    for(let i=0;i<g.length;i++){image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=g[i];image.data[i*4+3]=255;}
    ctx.putImageData(image,0,0);
  }
  function variant(source, option) {
    const radians=(option.angle||0)*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
    // Bound the rotated output too, including unusually diagonal square crops.
    const scale=Math.min(option.scale||1,1750/(source.width*cos+source.height*sin),1750/(source.height*cos+source.width*sin));
    const w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
    const content=canvas(w,h),image=content.getContext('2d');
    image.imageSmoothingEnabled=option.smooth!==false;image.drawImage(source,0,0,w,h);
    filter(content,option.mode||'color');
    const pad=24,c=canvas(w*cos+h*sin+pad*2,h*cos+w*sin+pad*2),ctx=c.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
    ctx.imageSmoothingEnabled=option.smooth!==false;
    ctx.translate(c.width/2,c.height/2);ctx.rotate(radians);ctx.drawImage(content,-w/2,-h/2,w,h);ctx.setTransform(1,0,0,1,0,0);
    content.width=1;content.height=1;return c;
  }
  async function decode(source, read, options={}) {
    const base=variant(source,{scale:Math.min(1,1600/Math.max(source.width,source.height))});
    const correction=deskew(base),upscale=Math.min(2,1500/Math.max(source.width,source.height));
    const plan=[
      {label:'original colors',mode:'color'},
      {label:'smaller image',mode:'color',scale:.65},
      {label:'larger sharp image',mode:'color',scale:upscale,smooth:false},
      {label:'grayscale',mode:'gray'},
      {label:'contrast',mode:'contrast'},
      {label:'straightened image',mode:'color',angle:correction},
      {label:'straightened contrast',mode:'contrast',angle:correction},
      {label:'sharpened edges',mode:'sharpen',angle:correction},
      {label:'black and white',mode:'binary',angle:correction},
      {label:'local shadow correction',mode:'adaptive',angle:correction},
      ...[-3,3,-6,6,-12,12].map((angle)=>({label:'rotation '+angle+'°',mode:'contrast',angle})),
      {label:'quarter turn',mode:'color',angle:90},
      {label:'quarter turn with contrast',mode:'contrast',angle:90},
      {label:'half turn',mode:'color',angle:180},
      {label:'inverted contrast',mode:'invert',angle:correction},
    ];
    const start=Date.now(),seen=new Set();let attempted=0;
    try {
      for(const option of plan){
        if(options.cancelled?.())throw Error('Scan stopped. Your photo is kept; adjust the crop or retry.');
        if(attempted && Date.now()-start>(options.budgetMs??20000))break;
        const signature=[option.mode,Math.round((option.angle||0)*10),Math.round((option.scale||1)*100),option.smooth].join(':');
        if(seen.has(signature))continue;seen.add(signature);attempted++;
        options.progress?.(option.label,attempted,plan.length);
        await new Promise((resolve)=>setTimeout(resolve,0));
        const c=variant(source,option);
        try {const value=await read(c);if(options.cancelled?.())throw Error('Scan stopped.');if(value)return value;}
        catch {if(options.cancelled?.())throw Error('Scan stopped. Your photo is kept; adjust the crop or retry.');}
        finally{c.width=1;c.height=1;}
      }
      throw Error('No readable code after enhancement. Retake straight on with better focus and no glare, or enter the printed barcode digits.');
    } finally {base.width=1;base.height=1;}
  }
  window.photoDecoder={decode};
})();

// Draw only geometric creases: coplanar GLB triangle edges stay hidden.
export async function createItemLineViewer(host,url){
  const [THREE,{GLTFLoader},{OrbitControls},{DRACOLoader},{MeshoptDecoder}]=await Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/loaders/GLTFLoader.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/controls/OrbitControls.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/loaders/DRACOLoader.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/meshopt_decoder.module.js/+esm')
  ]);
  if(!host.isConnected)throw Error('Visor cerrado.');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0xd3d4cf);
  const canvas=renderer.domElement;
  canvas.setAttribute('aria-label','Vista técnica 3D. Arrastra para girar y usa la rueda o dos dedos para acercar.');
  canvas.setAttribute('role','img');
  host.append(canvas);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(35,1,.001,10000);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;
  controls.screenSpacePanning=true;
  const draco=new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/');
  const loader=new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  let observer;
  let disposed=false;
  const render=()=>{if(!disposed)renderer.render(scene,camera);};
  const dispose=()=>{
    if(disposed)return;disposed=true;
    observer?.disconnect();controls.dispose();draco.dispose();
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    renderer.dispose();renderer.forceContextLoss();canvas.remove();
  };
  try{
    const gltf=await loader.loadAsync(url);
    gltf.scene.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const originals=Array.isArray(object.material)?object.material:[object.material];
      originals.filter(Boolean).forEach(material=>{
        materials.add(material);Object.values(material).forEach(value=>{if(value?.isTexture)textures.add(value);});
      });
    });
    if(!host.isConnected){dispose();throw Error('Visor cerrado.');}
    const meshes=[];
    gltf.scene.traverse(object=>{if(object.isMesh)meshes.push(object);});
    if(!meshes.length)throw Error('El GLB no contiene superficies para la vista técnica.');
    const faceMaterial=new THREE.MeshBasicMaterial({color:0xfafaf7,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const edgeMaterial=new THREE.LineBasicMaterial({color:0x252b28});
    materials.add(faceMaterial);materials.add(edgeMaterial);
    let edgeSegments=0;
    meshes.forEach(mesh=>{
      mesh.material=faceMaterial;
      const geometry=new THREE.EdgesGeometry(mesh.geometry,25);
      geometries.add(geometry);
      const copies=mesh.isInstancedMesh?mesh.count:1;
      edgeSegments+=geometry.attributes.position.count/2*copies;
      for(let i=0;i<copies;i++){
        const lines=new THREE.LineSegments(geometry,edgeMaterial);
        if(mesh.isInstancedMesh){mesh.getMatrixAt(i,lines.matrix);lines.matrixAutoUpdate=false;}
        mesh.add(lines);
      }
    });
    scene.add(gltf.scene);scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(gltf.scene);
    if(box.isEmpty())throw Error('El modelo no tiene geometría visible.');
    const center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.001);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.15;
    camera.position.copy(center).add(new THREE.Vector3(1,.85,1.2).normalize().multiplyScalar(distance));
    camera.near=radius/1000;camera.far=distance+radius*100;
    controls.target.copy(center);controls.minDistance=radius*.05;controls.maxDistance=radius*30;
    const resize=()=>{
      const width=host.clientWidth,height=host.clientHeight;
      if(!width||!height)return;
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();render();
    };
    observer=new ResizeObserver(resize);observer.observe(host);
    controls.addEventListener('change',render);controls.update();resize();
    host.dataset.edgeSegments=String(edgeSegments);
    return {dispose};
  }catch(error){dispose();throw error;}
}

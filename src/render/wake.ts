import * as THREE from 'three';

/** Foam trail: a ribbon through recent stern positions that widens and fades with age. Visual only. */
export class Wake {
  readonly mesh: THREE.Mesh;
  private readonly max = 240;
  private readonly points: { x: number; z: number; dx: number; dz: number; t: number; s: number }[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private lastT = -1;
  private readonly stern = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor() {
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.max * 2 * 3), 3));
    this.geo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(this.max * 2), 1));
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.93,0.97,1.0, vA); }',
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  update(boat: THREE.Object3D, stw: number, time: number): void {
    if (time - this.lastT >= 0.12) {
      this.lastT = time;
      const stern = this.stern.set(0, 0, 2.7).applyQuaternion(boat.quaternion).add(boat.position);
      const side = this.side.set(1, 0, 0).applyQuaternion(boat.quaternion);
      this.points.unshift({ x: stern.x, z: stern.z, dx: side.x, dz: side.z, t: time, s: stw });
      if (this.points.length > this.max) this.points.pop();
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('alpha') as THREE.BufferAttribute;
    for (let i = 0; i < this.max; i++) {
      const p = this.points[Math.min(i, this.points.length - 1)];
      if (!p) break;
      const age = time - p.t;
      const w = 0.25 + age * 0.18;
      const a = i < this.points.length ? Math.max(0, 0.32 * Math.min(1, p.s / 2.5) * Math.pow(1 - Math.min(1, age / 25), 2)) : 0;
      pos.setXYZ(i * 2, p.x - p.dx * w, 0.03, p.z - p.dz * w);
      pos.setXYZ(i * 2 + 1, p.x + p.dx * w, 0.03, p.z + p.dz * w);
      alpha.setX(i * 2, a);
      alpha.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}

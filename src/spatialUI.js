import * as THREE from 'three';

export class SpatialUI {
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.buttons = [];
    this.container = new THREE.Group();
    this.container.name = 'spatial_ui_container';

    // Position ergonomically on the user's left flank, tilted gently toward the viewer
    this.container.position.set(-0.42, 0.94, -0.54);
    this.container.rotation.y = Math.PI / 5.5;
    this.container.rotation.x = -Math.PI / 20;

    this.currentTab = 'primitives'; // 'primitives' | 'csg' | 'materials' | 'scene'
    this.isMinimized = false;
    this.activeColor = '#2563eb';
    this.activeMaterial = 'basic';
    this.gridSnapEnabled = true;

    this.scene.add(this.container);
    this._rebuildPanel();
  }

  _createTexture(drawFn, width = 512, height = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  _clearButtons() {
    this.buttons.forEach(btn => {
      this.container.remove(btn);
      if (btn.geometry) btn.geometry.dispose();
      if (btn.material) {
        if (btn.material.map) btn.material.map.dispose();
        btn.material.dispose();
      }
    });
    this.buttons = [];

    const toRemove = [];
    this.container.children.forEach(c => toRemove.push(c));
    toRemove.forEach(c => this.container.remove(c));
  }

  _addButton(x, y, w, h, label, sublabel, action, options = {}) {
    const geom = new THREE.BoxGeometry(w, h, 0.01);
    const {
      bgColor = '#0f172a',
      borderColor = options.active ? '#38bdf8' : 'rgba(56, 189, 248, 0.22)',
      textColor = '#f8fafc',
      colorDot = null,
      fontSize = 28
    } = options;

    const texture = this._createTexture((ctx, width, height) => {
      // Rounded dark glass button
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(8, 8, width - 16, height - 16, 22);
      ctx.fill();

      // Border glow
      ctx.lineWidth = options.active ? 6 : 3;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      // Color Dot indicator if present
      if (colorDot) {
        ctx.fillStyle = colorDot;
        ctx.beginPath();
        ctx.arc(56, height / 2, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // Main Text
      ctx.fillStyle = textColor;
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = colorDot ? 'left' : 'center';
      ctx.textBaseline = 'middle';
      const textX = colorDot ? 98 : width / 2;
      const textY = sublabel ? (height / 2 - 16) : (height / 2);
      ctx.fillText(label, textX, textY);

      // Sublabel
      if (sublabel) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '20px sans-serif';
        ctx.fillText(sublabel, textX, height / 2 + 22);
      }
    }, 512, 256);

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.2,
      metalness: 0.2
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, 0.01);
    mesh.userData = {
      isSpatialButton: true,
      action: action,
      origZ: 0.01
    };

    this.container.add(mesh);
    this.buttons.push(mesh);
    return mesh;
  }

  _rebuildPanel() {
    this._clearButtons();

    if (this.isMinimized) {
      this._buildMinimizedPill();
      return;
    }

    // Curved Frosted Dark Glass Frame (compact & aesthetic: 0.46m x 0.35m)
    const frameGeom = new THREE.BoxGeometry(0.48, 0.36, 0.006);
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x070b14,
      transparent: true,
      opacity: 0.88,
      roughness: 0.15,
      metalness: 0.35,
      clearcoat: 0.8
    });
    this.frame = new THREE.Mesh(frameGeom, frameMat);
    this.frame.name = 'base_frame';
    this.container.add(this.frame);

    // Slim Modern Header
    const bannerTex = this._createTexture((ctx, w, h) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 18);
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('💎 PICO CAD XR', 24, h / 2);

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('● Passthrough MR', w - 24, h / 2);
    }, 512, 128);

    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.042, 0.008),
      new THREE.MeshStandardMaterial({ map: bannerTex })
    );
    banner.position.set(-0.05, 0.146, 0.008);
    this.container.add(banner);

    // Minimize Button (Top Right corner)
    this._addButton(
      0.18, 0.146, 0.09, 0.042,
      '➖ Ocultar', '',
      () => {
        this.isMinimized = true;
        this._rebuildPanel();
      },
      { bgColor: '#1e293b', borderColor: '#475569', fontSize: 24 }
    );

    // 4 High-Utility Tabs
    const tabs = [
      { id: 'primitives', label: '🧱 Formas' },
      { id: 'csg', label: '⚡ Booleans' },
      { id: 'materials', label: '🎨 Color' },
      { id: 'scene', label: '💾 Escena' }
    ];
    const tabW = 0.11;
    const startX = -0.165;

    tabs.forEach((tab, i) => {
      const isActive = this.currentTab === tab.id;
      this._addButton(
        startX + i * tabW,
        0.098,
        tabW - 0.006,
        0.038,
        tab.label,
        '',
        () => {
          this.currentTab = tab.id;
          this._rebuildPanel();
        },
        {
          bgColor: isActive ? '#0284c7' : '#0f172a',
          borderColor: isActive ? '#38bdf8' : 'rgba(255,255,255,0.12)',
          active: isActive,
          fontSize: 22
        }
      );
    });

    switch (this.currentTab) {
      case 'primitives':
        this._buildPrimitivesTab();
        break;
      case 'csg':
        this._buildCSGTab();
        break;
      case 'materials':
        this._buildMaterialsTab();
        break;
      case 'scene':
        this._buildSceneTab();
        break;
    }
  }

  _buildMinimizedPill() {
    // Elegant floating micro-pill (0.24m x 0.05m) that leaves passthrough completely clear
    const frameGeom = new THREE.BoxGeometry(0.24, 0.052, 0.006);
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x070b14,
      transparent: true,
      opacity: 0.9,
      roughness: 0.15,
      metalness: 0.4
    });
    this.frame = new THREE.Mesh(frameGeom, frameMat);
    this.container.add(this.frame);

    this._addButton(
      0, 0, 0.22, 0.044,
      '💎 Abrir CAD Dock', 'Passthrough limpio',
      () => {
        this.isMinimized = false;
        this._rebuildPanel();
      },
      { bgColor: '#0284c7', borderColor: '#38bdf8', active: true, fontSize: 24 }
    );
  }

  _buildPrimitivesTab() {
    const items = [
      { id: 'box', label: '+ Cubo', sub: '200 mm' },
      { id: 'cylinder', label: '+ Cilindro', sub: 'Ø200 mm' },
      { id: 'sphere', label: '+ Esfera', sub: 'Ø200 mm' },
      { id: 'cone', label: '+ Cono', sub: 'Ø200 mm' },
      { id: 'wedge', label: '+ Cuña', sub: 'Rampa 45°' },
      { id: 'pyramid', label: '+ Pirámide', sub: 'Base 4' },
      { id: 'torus', label: '+ Torus', sub: 'Anillo' },
      { id: 'roof', label: '+ Techo', sub: 'Prisma' }
    ];

    const colW = 0.21;
    const rowH = 0.042;
    const startY = 0.036;

    items.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? -0.11 : 0.11;
      const y = startY - row * (rowH + 0.008);

      this._addButton(
        x, y, colW, rowH,
        item.label, item.sub,
        () => this.callbacks.addPrimitive(item.id),
        { bgColor: '#0f172a', borderColor: '#38bdf8', fontSize: 24 }
      );
    });

    this._addFooterHint('✨ Modificación directa: Apunte a las esferas del objeto para estirarlo.');
  }

  _buildCSGTab() {
    const colW = 0.21;
    const rowH = 0.048;

    this._addButton(
      -0.11, 0.028, colW, rowH,
      '🕳️ Sólido / Hueco', 'Alternar cortador',
      () => this.callbacks.toggleHole(),
      { bgColor: '#334155', borderColor: '#94a3b8', fontSize: 24 }
    );

    this._addButton(
      0.11, 0.028, colW, rowH,
      '⚡ Agrupar CSG', 'Unión o Sustracción',
      () => this.callbacks.group(),
      { bgColor: '#15803d', borderColor: '#22c55e', active: true, fontSize: 24 }
    );

    this._addButton(
      -0.11, -0.032, colW, rowH,
      '✂️ Intersección', 'Preservar cruce',
      () => this.callbacks.intersect && this.callbacks.intersect(),
      { bgColor: '#7c2d12', borderColor: '#ea580c', fontSize: 24 }
    );

    this._addButton(
      0.11, -0.032, colW, rowH,
      '📋 Duplicar', 'Clonar seleccionado',
      () => this.callbacks.duplicate(),
      { bgColor: '#1e293b', fontSize: 24 }
    );

    this._addButton(
      0, -0.092, 0.43, rowH,
      '🗑️ Eliminar Seleccionado', 'Remover del espacio',
      () => this.callbacks.delete(),
      { bgColor: '#7f1d1d', borderColor: '#ef4444', fontSize: 24 }
    );

    this._addFooterHint('Combine sólidos y huecos para vaciar o perforar piezas.');
  }

  _buildMaterialsTab() {
    const colors = [
      { hex: '#2563eb', name: 'Azul CAD' },
      { hex: '#f97316', name: 'Naranja' },
      { hex: '#10b981', name: 'Verde' },
      { hex: '#ef4444', name: 'Rojo' },
      { hex: '#eab308', name: 'Amarillo' },
      { hex: '#8b5cf6', name: 'Violeta' },
      { hex: '#f8fafc', name: 'Blanco' },
      { hex: '#1e293b', name: 'Grafito' }
    ];

    const colW = 0.21;
    const rowH = 0.038;
    const startY = 0.038;

    colors.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? -0.11 : 0.11;
      const y = startY - row * (rowH + 0.006);
      const isSelected = this.activeColor === c.hex;

      this._addButton(
        x, y, colW, rowH,
        c.name, '',
        () => {
          this.activeColor = c.hex;
          if (this.callbacks.setColor) this.callbacks.setColor(c.hex);
          this._rebuildPanel();
        },
        {
          bgColor: '#0f172a',
          colorDot: c.hex,
          active: isSelected,
          borderColor: isSelected ? '#38bdf8' : 'rgba(255,255,255,0.1)',
          fontSize: 22
        }
      );
    });

    this._addFooterHint('Seleccione cualquier pieza para aplicarle el color al instante.');
  }

  _buildSceneTab() {
    const fullW = 0.43;
    const rowH = 0.046;

    this._addButton(
      0, 0.034, fullW, rowH,
      '⬇️ Asentar Todo a Mesa', 'Nivelar objetos a Y = 0',
      () => this.callbacks.dropToWorkplane && this.callbacks.dropToWorkplane(),
      { bgColor: '#1e293b', borderColor: '#38bdf8', fontSize: 24 }
    );

    this._addButton(
      0, -0.022, fullW, rowH,
      this.gridSnapEnabled ? '🧲 Snap a Grilla: 25 mm' : '🧲 Snap a Grilla: OFF', 'Imantación magnética',
      () => {
        this.gridSnapEnabled = !this.gridSnapEnabled;
        if (this.callbacks.toggleGridSnap) this.callbacks.toggleGridSnap(this.gridSnapEnabled);
        this._rebuildPanel();
      },
      {
        bgColor: this.gridSnapEnabled ? '#065f46' : '#374151',
        borderColor: this.gridSnapEnabled ? '#10b981' : '#6b7280',
        active: this.gridSnapEnabled,
        fontSize: 24
      }
    );

    this._addButton(
      0, -0.078, fullW, rowH,
      '💾 Exportar STL (Impresión 3D)', 'Malla estanca lista para slicer',
      () => this.callbacks.exportSTL(),
      { bgColor: '#0369a1', borderColor: '#38bdf8', active: true, fontSize: 24 }
    );

    this._addFooterHint('Los archivos se exportan directo al almacenamiento de su PICO.');
  }

  _addFooterHint(text) {
    const hintTex = this._createTexture((ctx, w, h) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 14);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '19px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
    }, 512, 80);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.43, 0.028, 0.006),
      new THREE.MeshStandardMaterial({ map: hintTex })
    );
    mesh.position.set(0, -0.144, 0.008);
    this.container.add(mesh);
  }

  handleRayIntersection(intersects) {
    for (const hit of intersects) {
      if (hit.object && hit.object.userData && hit.object.userData.isSpatialButton) {
        return hit.object;
      }
    }
    return null;
  }

  triggerButton(btn) {
    if (!btn || !btn.userData || !btn.userData.action) return;

    btn.position.z = 0.005;
    setTimeout(() => {
      btn.position.z = btn.userData.origZ || 0.01;
    }, 120);

    btn.userData.action();
  }
}

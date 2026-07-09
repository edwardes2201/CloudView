// js/measurements-ui.js

class MeasurementsUI {
	constructor(viewer, storage) {
		this.viewer = viewer;
		this.storage = storage;
		this.panelVisible = false;
		
		this.panel = document.getElementById('measurementLayerControl');
		this.toggleBtn = document.getElementById('toggleLayerBtn');
		this.closeBtn = document.getElementById('toggleLayerPanel');
		this.layerList = document.getElementById('layerList');
		this.newLayerInput = document.getElementById('newLayerInput');
		this.addBtn = document.getElementById('addLayerBtn');
		this.saveBtn = document.getElementById('saveMeasurementsBtn');
		this.clearBtn = document.getElementById('clearMeasurementsBtn');
		this.countDisplay = document.getElementById('measurementCount');
		
		if (!this.panel) {
			console.warn('[MeasurementsUI] Elementos DOM no encontrados');
			return;
		}
		
		this.initEventListeners();
		this.renderLayers();
		this.updateMeasurementCount();
		
		console.log('[MeasurementsUI] Inicializado');
	}

	initEventListeners() {
		this.toggleBtn.addEventListener('click', () => this.togglePanel());
		this.closeBtn.addEventListener('click', () => this.hidePanel());

		this.addBtn.addEventListener('click', () => this.addLayer());
		this.newLayerInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') this.addLayer();
		});

		this.saveBtn.addEventListener('click', () => this.saveAll());
		this.clearBtn.addEventListener('click', () => this.clearAll());

		this.storage.addEventListener('layer_added', () => this.renderLayers());
		this.storage.addEventListener('layer_removed', () => this.renderLayers());
		this.storage.addEventListener('layer_updated', () => this.renderLayers());
		this.storage.addEventListener('measurements_saved', () => {
			this.renderLayers();
			this.updateMeasurementCount();
		});
		this.storage.addEventListener('measurements_loaded', () => {
			this.renderLayers();
			this.updateMeasurementCount();
		});
		this.storage.addEventListener('measurements_changed', () => {
			this.updateMeasurementCount();
		});

		this.viewer.scene.addEventListener('measurement_added', () => {
			this.renderLayers();
			this.updateMeasurementCount();
		});
		
		this.viewer.scene.addEventListener('measurement_removed', () => {
			this.renderLayers();
			this.updateMeasurementCount();
		});

		this.viewer.inputHandler.addEventListener('selection_changed', (e) => {
			const selection = e.selection || [];
			this.highlightSelectedLayers(selection);
		});
		
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.panelVisible) {
				this.hidePanel();
			}
		});
	}

	togglePanel() {
		if (this.panelVisible) {
			this.hidePanel();
		} else {
			this.showPanel();
		}
	}

	showPanel() {
		this.panelVisible = true;
		this.panel.style.display = 'block';
		this.panel.classList.add('show');
		this.toggleBtn.textContent = '✕ Cerrar capas';
		this.renderLayers();
	}

	hidePanel() {
		this.panelVisible = false;
		this.panel.style.display = 'none';
		this.panel.classList.remove('show');
		this.toggleBtn.textContent = '📐 Capas';
	}

	renderLayers() {
		if (!this.layerList) return;
		
		const layers = this.storage.layers;
		const stats = this.storage.getStats();
		
		this.layerList.innerHTML = '';
		
		if (layers.length === 0) {
			this.layerList.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">No hay capas</div>';
			return;
		}

		const sortedLayers = [...layers].sort((a, b) => {
			if (a === 'default') return -1;
			if (b === 'default') return 1;
			return a.localeCompare(b);
		});

		for (const layer of sortedLayers) {
			const count = stats[layer] || 0;
			const color = this.storage.getLayerColor(layer);
			const isDefault = layer === 'default';
			
			const item = document.createElement('div');
			item.className = 'layer-item';
			item.dataset.layer = layer;
			
			const nameDiv = document.createElement('div');
			nameDiv.className = 'layer-name';
			
			const colorSpan = document.createElement('span');
			colorSpan.className = 'layer-color';
			colorSpan.style.backgroundColor = color;
			nameDiv.appendChild(colorSpan);
			
			const nameSpan = document.createElement('span');
			nameSpan.textContent = layer;
			nameDiv.appendChild(nameSpan);
			
			const countSpan = document.createElement('span');
			countSpan.className = 'layer-count';
			countSpan.textContent = `(${count})`;
			nameDiv.appendChild(countSpan);
			
			item.appendChild(nameDiv);
			
			const actions = document.createElement('div');
			actions.className = 'layer-actions';
			
			const visBtn = document.createElement('button');
			visBtn.innerHTML = '👁';
			visBtn.title = 'Mostrar/Ocultar capa';
			visBtn.dataset.visible = 'true';
			visBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const visible = visBtn.dataset.visible !== 'false';
				this.toggleLayerVisibility(layer, !visible);
				visBtn.dataset.visible = visible ? 'false' : 'true';
				visBtn.style.opacity = visible ? '0.4' : '1';
				visBtn.innerHTML = visible ? '👁' : '👁‍🗨';
			});
			actions.appendChild(visBtn);
			
			const colorBtn = document.createElement('button');
			colorBtn.innerHTML = '🎨';
			colorBtn.title = 'Cambiar color de capa';
			colorBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.showColorPicker(layer);
			});
			actions.appendChild(colorBtn);
			
			if (!isDefault) {
				const delBtn = document.createElement('button');
				delBtn.innerHTML = '✕';
				delBtn.className = 'delete-layer';
				delBtn.title = 'Eliminar capa';
				delBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					if (confirm(`¿Eliminar la capa "${layer}" y mover sus mediciones a "default"?`)) {
						this.storage.removeLayer(layer);
					}
				});
				actions.appendChild(delBtn);
			}
			
			item.appendChild(actions);
			
			item.addEventListener('click', () => {
				this.selectLayer(layer);
			});
			
			this.layerList.appendChild(item);
		}
	}

	toggleLayerVisibility(layerName, visible) {
		const measurements = this.viewer.scene.measurements;
		let count = 0;
		
		for (const m of measurements) {
			if (m.layer === layerName) {
				m.visible = visible;
				count++;
			}
		}
		
		console.log(`[MeasurementsUI] Capa "${layerName}": ${count} mediciones ${visible ? 'mostradas' : 'ocultas'}`);
	}

	selectLayer(layerName) {
		const measurements = this.viewer.scene.measurements;
		const selected = [];
		
		this.viewer.inputHandler.deselectAll();
		
		for (const m of measurements) {
			if (m.layer === layerName) {
				this.viewer.inputHandler.toggleSelection(m);
				selected.push(m);
			}
		}
		
		if (selected.length > 0) {
			console.log(`[MeasurementsUI] Seleccionadas ${selected.length} mediciones de "${layerName}"`);
			
			if (selected.length === 1) {
				const points = selected[0].points.map(p => p.position);
				if (points.length > 0) {
					const box = new THREE.Box3().setFromPoints(points);
					if (box.getSize(new THREE.Vector3()).length() > 0) {
						const node = new THREE.Object3D();
						node.boundingBox = box;
						this.viewer.zoomTo(node, 1.5, 500);
					}
				}
			}
		}
	}

	highlightSelectedLayers(selection) {
		const selectedLayers = new Set();
		
		for (const obj of selection) {
			if (obj instanceof Potree.Measure && obj.layer) {
				selectedLayers.add(obj.layer);
			}
		}
		
		const items = this.layerList.querySelectorAll('.layer-item');
		for (const item of items) {
			const layer = item.dataset.layer;
			if (selectedLayers.has(layer)) {
				item.style.border = '2px solid #108FB9';
				item.style.background = 'rgba(16, 143, 185, 0.2)';
			} else {
				item.style.border = 'none';
				item.style.background = '#39474B';
			}
		}
	}

	showColorPicker(layerName) {
		const currentColor = this.storage.getLayerColor(layerName);
		
		const input = document.createElement('input');
		input.type = 'color';
		input.value = currentColor;
		input.style.position = 'fixed';
		input.style.opacity = '0';
		input.style.pointerEvents = 'none';
		document.body.appendChild(input);
		
		input.addEventListener('input', () => {
			this.storage.setLayerColor(layerName, input.value);
			this.renderLayers();
		});
		
		input.click();
		
		setTimeout(() => {
			document.body.removeChild(input);
		}, 1000);
	}

	addLayer() {
		const name = this.newLayerInput.value.trim();
		if (!name) {
			this.newLayerInput.style.borderColor = '#ff6b6b';
			setTimeout(() => {
				this.newLayerInput.style.borderColor = '';
			}, 2000);
			return;
		}
		
		if (this.storage.addLayer(name)) {
			this.newLayerInput.value = '';
			this.newLayerInput.style.borderColor = '#4ECDC4';
			setTimeout(() => {
				this.newLayerInput.style.borderColor = '';
			}, 2000);
			
			const selection = this.viewer.inputHandler.selection || [];
			for (const obj of selection) {
				if (obj instanceof Potree.Measure) {
					obj.layer = name;
				}
			}
			
			this.storage.saveMeasurements();
			this.renderLayers();
		} else {
			this.newLayerInput.style.borderColor = '#ff6b6b';
			setTimeout(() => {
				this.newLayerInput.style.borderColor = '';
			}, 2000);
		}
	}

	saveAll() {
		this.storage.saveMeasurements();
		const count = this.viewer.scene.measurements.length;
		
		const msg = `Guardadas ${count} mediciones en ${this.storage.layers.length} capas`;
		this.viewer.postMessage(msg, { duration: 2000 });
		
		this.saveBtn.textContent = '✅ Guardado';
		setTimeout(() => {
			this.saveBtn.textContent = '💾 Guardar';
		}, 2000);
	}

	clearAll() {
		const count = this.viewer.scene.measurements.length;
		
		if (count === 0) {
			this.viewer.postMessage('No hay mediciones para limpiar', { duration: 1500 });
			return;
		}
		
		if (confirm(`¿Eliminar todas las ${count} mediciones guardadas?`)) {
			this.storage.clearAll();
			this.viewer.scene.removeAllMeasurements();
			this.renderLayers();
			this.updateMeasurementCount();
			this.viewer.postMessage(`Todas las mediciones eliminadas`, { duration: 2000 });
		}
	}

	updateMeasurementCount() {
		if (!this.countDisplay) return;
		
		const count = this.viewer.scene.measurements.length;
		const layers = this.storage.layers.length;
		this.countDisplay.textContent = `${count} mediciones en ${layers} capas`;
	}
}
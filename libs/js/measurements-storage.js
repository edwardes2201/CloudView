// js/measurements-storage.js

class MeasurementsStorage {
	constructor(viewer) {
		this.viewer = viewer;
		this.storageKey = 'potree_measurements_data';
		this.layerKey = 'potree_layers_data';
		this.autoSave = true;
		this.saveDelay = 1000;
		this.saveTimeout = null;
		this._layers = new Set(['default']);
		this._layerColors = new Map();
		
		this.loadLayers();
		this.setupAutoSave();
		this.setupViewerEvents();
		
		console.log('[MeasurementsStorage] Inicializado');
	}

	get layers() {
		return Array.from(this._layers);
	}

	getLayerColor(layerName) {
		if (this._layerColors.has(layerName)) {
			return this._layerColors.get(layerName);
		}
		
		const colors = [
			'#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
			'#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
			'#F1948A', '#82E0AA', '#F8C471', '#85C1E9', '#D7BDE2'
		];
		
		let hash = 0;
		for (let i = 0; i < layerName.length; i++) {
			hash = layerName.charCodeAt(i) + ((hash << 5) - hash);
		}
		const index = Math.abs(hash) % colors.length;
		const color = colors[index];
		
		this._layerColors.set(layerName, color);
		this.saveLayers();
		return color;
	}

	setLayerColor(layerName, color) {
		this._layerColors.set(layerName, color);
		this.saveLayers();
		this.dispatchEvent({ type: 'layer_updated', layer: layerName });
	}

	addLayer(layerName) {
		layerName = layerName.trim();
		if (!layerName) return false;
		
		if (!this._layers.has(layerName)) {
			this._layers.add(layerName);
			this.saveLayers();
			this.dispatchEvent({ type: 'layer_added', layer: layerName });
			return true;
		}
		return false;
	}

	removeLayer(layerName) {
		if (layerName === 'default') return false;
		
		if (this._layers.has(layerName)) {
			this._layers.delete(layerName);
			this._layerColors.delete(layerName);
			
			const measurements = this.viewer.scene.measurements;
			for (const m of measurements) {
				if (m.layer === layerName) {
					m.layer = 'default';
				}
			}
			
			this.saveLayers();
			this.saveMeasurements();
			this.dispatchEvent({ type: 'layer_removed', layer: layerName });
			return true;
		}
		return false;
	}

	setupAutoSave() {
		let lastChange = 0;
		
		this.viewer.addEventListener('update', () => {
			if (this.autoSave) {
				const now = Date.now();
				if (now - lastChange > this.saveDelay) {
					if (this.saveTimeout) {
						clearTimeout(this.saveTimeout);
					}
					this.saveTimeout = setTimeout(() => {
						this.saveMeasurements();
					}, 100);
				}
				lastChange = now;
			}
		});
	}

	setupViewerEvents() {
		this.viewer.scene.addEventListener('measurement_added', () => {
			if (this.autoSave) {
				setTimeout(() => this.saveMeasurements(), 100);
			}
		});
		
		this.viewer.scene.addEventListener('measurement_removed', () => {
			if (this.autoSave) this.saveMeasurements();
		});

		const measureListener = (m) => {
			m.addEventListener('layer_changed', () => {
				if (this.autoSave) {
					this.saveMeasurements();
					this.dispatchEvent({ type: 'measurements_changed' });
				}
			});
			
			m.addEventListener('marker_moved', () => {
				if (this.autoSave) {
					if (this.saveTimeout) clearTimeout(this.saveTimeout);
					this.saveTimeout = setTimeout(() => {
						this.saveMeasurements();
					}, this.saveDelay);
				}
			});
		};

		for (const m of this.viewer.scene.measurements) {
			measureListener(m);
		}

		this.viewer.scene.addEventListener('measurement_added', (e) => {
			measureListener(e.measurement);
		});
	}

	getMeasurementsData() {
		const measurements = this.viewer.scene.measurements;
		const data = measurements
			.filter(m => m.persistent !== false)
			.map(m => {
				if (typeof m.toJSON === 'function') {
					return m.toJSON();
				}
				return {
					type: 'line',
					id: m._id || Date.now(),
					uuid: m.uuid || Potree.MathUtils.generateUUID(),
					name: m.name || 'Measurement',
					layer: m.layer || 'default',
					color: m.color ? m.color.toArray() : [1, 0, 0],
					points: m.points.map(p => p.position.toArray()),
					showDistances: m._showDistances,
					showCoordinates: m._showCoordinates || false,
					showArea: m._showArea || false,
					closed: m._closed !== undefined ? m._closed : true,
					showAngles: m._showAngles || false,
					showHeight: m._showHeight || false,
					showCircle: m._showCircle || false,
					showAzimuth: m._showAzimuth || false,
					showEdges: m._showEdges !== undefined ? m._showEdges : true,
					maxMarkers: m.maxMarkers || Infinity,
					persistent: m.persistent !== undefined ? m.persistent : true
				};
			});
		return data;
	}

	saveMeasurements() {
		try {
			const data = this.getMeasurementsData();
			localStorage.setItem(this.storageKey, JSON.stringify(data));
			this.saveLayers();
			this.dispatchEvent({ type: 'measurements_saved', count: data.length });
			console.log(`[MeasurementsStorage] Guardadas ${data.length} mediciones`);
		} catch (error) {
			console.error('[MeasurementsStorage] Error al guardar:', error);
		}
	}

	loadMeasurements() {
		try {
			const data = localStorage.getItem(this.storageKey);
			if (!data) return 0;

			const measurements = JSON.parse(data);
			let loadedCount = 0;
			
			const toRemove = this.viewer.scene.measurements.filter(m => m.persistent !== false);
			for (const m of toRemove) {
				this.viewer.scene.removeMeasurement(m);
			}

			for (const mData of measurements) {
				try {
					let measure;
					if (typeof Potree.Measure !== 'undefined' && Potree.Measure.fromJSON) {
						measure = Potree.Measure.fromJSON(mData, this.viewer);
					} else {
						measure = this.createMeasurementFromData(mData);
					}
					
					if (measure) {
						this.viewer.scene.addMeasurement(measure);
						loadedCount++;
					}
				} catch (err) {
					console.warn('[MeasurementsStorage] Error al cargar medición:', err);
				}
			}
			
			this.dispatchEvent({ type: 'measurements_loaded', count: loadedCount });
			console.log(`[MeasurementsStorage] Cargadas ${loadedCount} mediciones`);
			return loadedCount;
		} catch (error) {
			console.error('[MeasurementsStorage] Error al cargar:', error);
			return 0;
		}
	}

	createMeasurementFromData(data) {
		const measure = new Potree.Measure();
		
		measure.uuid = data.uuid || Potree.MathUtils.generateUUID();
		measure._id = data.id || Date.now();
		measure.name = data.name || 'Measurement';
		measure.layer = data.layer || 'default';
		
		measure._showDistances = data.showDistances !== undefined ? data.showDistances : true;
		measure._showCoordinates = data.showCoordinates || false;
		measure._showArea = data.showArea || false;
		measure._closed = data.closed !== undefined ? data.closed : true;
		measure._showAngles = data.showAngles || false;
		measure._showHeight = data.showHeight || false;
		measure._showCircle = data.showCircle || false;
		measure._showAzimuth = data.showAzimuth || false;
		measure._showEdges = data.showEdges !== undefined ? data.showEdges : true;
		measure.maxMarkers = data.maxMarkers || Infinity;
		measure.persistent = data.persistent !== undefined ? data.persistent : true;

		for (const point of data.points) {
			const pos = new THREE.Vector3(...point);
			measure.addMarker(pos);
		}

		if (data.color) {
			measure.color = new THREE.Color(data.color);
		}

		return measure;
	}

	saveLayers() {
		try {
			const layers = Array.from(this._layers);
			const layerColors = {};
			for (const [name, color] of this._layerColors) {
				layerColors[name] = color;
			}
			
			const data = {
				layers: layers,
				colors: layerColors
			};
			localStorage.setItem(this.layerKey, JSON.stringify(data));
		} catch (error) {
			console.error('[MeasurementsStorage] Error al guardar capas:', error);
		}
	}

	loadLayers() {
		try {
			const data = localStorage.getItem(this.layerKey);
			if (data) {
				const parsed = JSON.parse(data);
				if (parsed.layers) {
					this._layers = new Set(parsed.layers);
				}
				if (parsed.colors) {
					for (const [name, color] of Object.entries(parsed.colors)) {
						this._layerColors.set(name, color);
					}
				}
			}
			if (!this._layers.has('default')) {
				this._layers.add('default');
			}
		} catch (error) {
			console.error('[MeasurementsStorage] Error al cargar capas:', error);
			this._layers = new Set(['default']);
		}
	}

	clearAll() {
		localStorage.removeItem(this.storageKey);
		localStorage.removeItem(this.layerKey);
		this._layers = new Set(['default']);
		this._layerColors.clear();
		this.dispatchEvent({ type: 'cleared' });
	}

	getStats() {
		const measurements = this.viewer.scene.measurements;
		const stats = {};
		
		for (const m of measurements) {
			const layer = m.layer || 'default';
			stats[layer] = (stats[layer] || 0) + 1;
		}
		
		return stats;
	}

	_listeners = {};

	addEventListener(type, callback) {
		if (!this._listeners[type]) this._listeners[type] = [];
		this._listeners[type].push(callback);
	}

	removeEventListener(type, callback) {
		if (!this._listeners[type]) return;
		this._listeners[type] = this._listeners[type].filter(cb => cb !== callback);
	}

	dispatchEvent(event) {
		const listeners = this._listeners[event.type] || [];
		for (const listener of listeners) {
			try {
				listener(event);
			} catch (err) {
				console.error('Error en event listener:', err);
			}
		}
	}
}
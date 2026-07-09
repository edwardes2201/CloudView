// js/measurements-storage.js

/**
 * Sistema de persistencia para mediciones de Potree
 * Guarda y carga mediciones automáticamente usando localStorage
 */
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
		
		// Cargar capas guardadas
		this.loadLayers();
		
		// Configurar auto-guardado
		this.setupAutoSave();
		this.setupViewerEvents();
		
		console.log('[MeasurementsStorage] Inicializado');
	}

	// --- Getter de capas ---
	get layers() {
		return Array.from(this._layers);
	}

	// --- Obtener color de una capa ---
	getLayerColor(layerName) {
		if (this._layerColors.has(layerName)) {
			return this._layerColors.get(layerName);
		}
		
		// Generar color automático basado en el nombre
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

	// --- Añadir capa ---
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

	// --- Eliminar capa ---
	removeLayer(layerName) {
		if (layerName === 'default') return false;
		
		if (this._layers.has(layerName)) {
			this._layers.delete(layerName);
			this._layerColors.delete(layerName);
			
			// Mover mediciones de esta capa a 'default'
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

	// --- Renombrar capa ---
	renameLayer(oldName, newName) {
		if (oldName === 'default' || !this._layers.has(oldName)) return false;
		if (this._layers.has(newName)) return false;
		
		this._layers.delete(oldName);
		this._layers.add(newName);
		
		if (this._layerColors.has(oldName)) {
			this._layerColors.set(newName, this._layerColors.get(oldName));
			this._layerColors.delete(oldName);
		}
		
		// Actualizar mediciones
		for (const m of this.viewer.scene.measurements) {
			if (m.layer === oldName) {
				m.layer = newName;
			}
		}
		
		this.saveLayers();
		this.saveMeasurements();
		this.dispatchEvent({ type: 'layer_renamed', oldName, newName });
		return true;
	}

	// --- Configurar auto-guardado ---
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

	// --- Configurar eventos del viewer ---
	setupViewerEvents() {
		// Guardar cuando se agrega o elimina una medición
		this.viewer.scene.addEventListener('measurement_added', () => {
			if (this.autoSave) {
				// Pequeño delay para permitir que la medición se inicialice completamente
				setTimeout(() => this.saveMeasurements(), 100);
			}
		});
		
		this.viewer.scene.addEventListener('measurement_removed', () => {
			if (this.autoSave) this.saveMeasurements();
		});

		// Escuchar cambios de capa
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

		// Aplicar a mediciones existentes
		for (const m of this.viewer.scene.measurements) {
			measureListener(m);
		}

		// Aplicar a nuevas mediciones
		this.viewer.scene.addEventListener('measurement_added', (e) => {
			measureListener(e.measurement);
		});
	}

	// --- Obtener datos de mediciones ---
	getMeasurementsData() {
		const measurements = this.viewer.scene.measurements;
		const data = measurements
			.filter(m => m.persistent !== false)
			.map(m => {
				// Asegurar que la medición tenga el método toJSON
				if (typeof m.toJSON === 'function') {
					return m.toJSON();
				}
				// Fallback para mediciones antiguas
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

	// --- Guardar mediciones ---
	saveMeasurements() {
		try {
			const data = this.getMeasurementsData();
			localStorage.setItem(this.storageKey, JSON.stringify(data));
			
			// También guardar las capas
			this.saveLayers();
			
			this.dispatchEvent({ 
				type: 'measurements_saved', 
				count: data.length 
			});
			
			console.log(`[MeasurementsStorage] Guardadas ${data.length} mediciones`);
		} catch (error) {
			console.error('[MeasurementsStorage] Error al guardar:', error);
		}
	}

	// --- Cargar mediciones ---
	loadMeasurements() {
		try {
			const data = localStorage.getItem(this.storageKey);
			if (!data) return;

			const measurements = JSON.parse(data);
			let loadedCount = 0;
			
			// Limpiar mediciones existentes que sean persistentes
			const toRemove = this.viewer.scene.measurements.filter(m => m.persistent !== false);
			for (const m of toRemove) {
				this.viewer.scene.removeMeasurement(m);
			}

			// Cargar mediciones guardadas
			for (const mData of measurements) {
				try {
					// Usar el método fromJSON si existe, o crear manualmente
					let measure;
					if (typeof Potree.Measure !== 'undefined' && Potree.Measure.fromJSON) {
						measure = Potree.Measure.fromJSON(mData, this.viewer);
					} else {
						// Fallback: crear medición manualmente
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
			
			this.dispatchEvent({ 
				type: 'measurements_loaded', 
				count: loadedCount 
			});
			
			console.log(`[MeasurementsStorage] Cargadas ${loadedCount} mediciones`);
			return loadedCount;
		} catch (error) {
			console.error('[MeasurementsStorage] Error al cargar:', error);
			return 0;
		}
	}

	// --- Crear medición desde datos (fallback) ---
	createMeasurementFromData(data) {
		const measure = new Potree.Measure();
		
		measure.uuid = data.uuid || Potree.MathUtils.generateUUID();
		measure._id = data.id || Date.now();
		measure.name = data.name || 'Measurement';
		measure.layer = data.layer || 'default';
		
		// Restaurar propiedades
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

		// Agregar puntos
		for (const point of data.points) {
			const pos = new THREE.Vector3(...point);
			measure.addMarker(pos);
		}

		// Asignar color
		if (data.color) {
			measure.color = new THREE.Color(data.color);
		}

		return measure;
	}

	// --- Guardar capas ---
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

	// --- Cargar capas ---
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
			// Asegurar que 'default' existe
			if (!this._layers.has('default')) {
				this._layers.add('default');
			}
		} catch (error) {
			console.error('[MeasurementsStorage] Error al cargar capas:', error);
			this._layers = new Set(['default']);
		}
	}

	// --- Limpiar todo ---
	clearAll() {
		localStorage.removeItem(this.storageKey);
		localStorage.removeItem(this.layerKey);
		this._layers = new Set(['default']);
		this._layerColors.clear();
		this.dispatchEvent({ type: 'cleared' });
	}

	// --- Obtener estadísticas ---
	getStats() {
		const measurements = this.viewer.scene.measurements;
		const stats = {};
		
		for (const m of measurements) {
			const layer = m.layer || 'default';
			stats[layer] = (stats[layer] || 0) + 1;
		}
		
		return stats;
	}

	// --- Sistema de eventos ---
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
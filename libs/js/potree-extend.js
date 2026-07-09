// js/potree-extend.js

/**
 * Extensión de Potree para añadir persistencia a las mediciones
 */

(function() {
	if (typeof Potree === 'undefined') {
		console.error('Potree no está cargado');
		return;
	}

	const Measure = Potree.Measure;
	if (!Measure) {
		console.error('La clase Measure no está disponible');
		return;
	}

	// Extender la clase Measure
	class ExtendedMeasure extends Measure {
		constructor() {
			super();
			this._uuid = Potree.MathUtils.generateUUID();
			this._layer = 'default';
			this._id = Date.now() + Math.random() * 1000;
			this._persistent = true;
			this._color = new THREE.Color(0xff0000);
			
			if (this.color) {
				this._color.copy(this.color);
			}
		}

		get uuid() { return this._uuid; }
		set uuid(value) { this._uuid = value; }

		get layer() { return this._layer; }
		set layer(value) {
			if (this._layer !== value) {
				const oldLayer = this._layer;
				this._layer = value;
				
				if (window.measurementStorage) {
					const color = window.measurementStorage.getLayerColor(value);
					if (color && this._color) {
						this._color.set(color);
						if (this.color) {
							this.color.copy(this._color);
						}
					}
				}
				
				this.dispatchEvent({
					type: 'layer_changed',
					measurement: this,
					layer: value,
					oldLayer: oldLayer
				});
			}
		}

		get id() { return this._id; }
		set id(value) { this._id = value; }

		get persistent() { return this._persistent; }
		set persistent(value) { this._persistent = value; }

		get color() { return this._color; }
		set color(value) {
			this._color.copy(value);
			if (this.spheres) {
				for (const sphere of this.spheres) {
					if (sphere.material) {
						sphere.material.color.copy(this._color);
					}
				}
			}
			if (this.edges) {
				for (const edge of this.edges) {
					if (edge.material) {
						edge.material.color.copy(this._color);
					}
				}
			}
		}

		toJSON() {
			const points = this.points.map(p => {
				const pos = p.position || p;
				if (pos instanceof THREE.Vector3) {
					return pos.toArray();
				}
				return [pos.x, pos.y, pos.z];
			});

			return {
				type: 'line',
				id: this._id,
				uuid: this._uuid,
				name: this.name || 'Measurement',
				layer: this._layer,
				color: this._color.toArray(),
				points: points,
				showDistances: this._showDistances !== undefined ? this._showDistances : true,
				showCoordinates: this._showCoordinates || false,
				showArea: this._showArea || false,
				closed: this._closed !== undefined ? this._closed : true,
				showAngles: this._showAngles || false,
				showHeight: this._showHeight || false,
				showCircle: this._showCircle || false,
				showAzimuth: this._showAzimuth || false,
				showEdges: this._showEdges !== undefined ? this._showEdges : true,
				maxMarkers: this.maxMarkers || Infinity,
				persistent: this._persistent !== undefined ? this._persistent : true
			};
		}

		static fromJSON(data, viewer) {
			const measure = new ExtendedMeasure();
			
			measure.uuid = data.uuid || Potree.MathUtils.generateUUID();
			measure._id = data.id || Date.now() + Math.random() * 1000;
			measure.name = data.name || 'Measurement';
			measure._layer = data.layer || 'default';
			
			if (data.color) {
				measure._color = new THREE.Color(data.color);
			}
			
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
			measure._persistent = data.persistent !== undefined ? data.persistent : true;

			for (const point of data.points) {
				const pos = new THREE.Vector3(...point);
				measure.addMarker(pos);
			}

			measure.color = measure._color;
			return measure;
		}
	}

	// Reemplazar la clase Measure
	Potree.Measure = ExtendedMeasure;
	
	// Extender Scene
	if (Potree.Scene) {
		const originalAddMeasurement = Potree.Scene.prototype.addMeasurement;
		Potree.Scene.prototype.addMeasurement = function(measurement) {
			if (!measurement.uuid) {
				measurement.uuid = Potree.MathUtils.generateUUID();
			}
			if (!measurement._id) {
				measurement._id = Date.now() + Math.random() * 1000;
			}
			if (!measurement._persistent) {
				measurement._persistent = true;
			}
			return originalAddMeasurement.call(this, measurement);
		};
	}

	// Extender MeasuringTool
	if (Potree.MeasuringTool) {
		const originalStartInsertion = Potree.MeasuringTool.prototype.startInsertion;
		Potree.MeasuringTool.prototype.startInsertion = function(args = {}) {
			const measure = new ExtendedMeasure();
			
			measure.name = args.name || 'Measurement';
			measure._showDistances = args.showDistances !== undefined ? args.showDistances : true;
			measure._showArea = args.showArea || false;
			measure._showAngles = args.showAngles || false;
			measure._showCoordinates = args.showCoordinates || false;
			measure._showHeight = args.showHeight || false;
			measure._showCircle = args.showCircle || false;
			measure._showAzimuth = args.showAzimuth || false;
			measure._showEdges = args.showEdges !== undefined ? args.showEdges : true;
			measure._closed = args.closed !== undefined ? args.closed : false;
			measure.maxMarkers = args.maxMarkers || Infinity;
			measure._persistent = args.persistent !== undefined ? args.persistent : true;
			
			if (args.layer) {
				measure._layer = args.layer;
			}

			const result = originalStartInsertion.call(this, {
				...args,
				_measurement: measure
			});

			if (result instanceof Potree.Measure) {
				return measure;
			}
			return measure;
		};
	}

	console.log('[PotreeExtend] Clase Measure extendida con persistencia');
})();
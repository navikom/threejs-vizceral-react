/**
 *
 *  Copyright 2016 Netflix, Inc.
 *
 *     Licensed under the Apache License, Version 2.0 (the "License");
 *     you may not use this file except in compliance with the License.
 *     You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 *     Unless required by applicable law or agreed to in writing, software
 *     distributed under the License is distributed on an "AS IS" BASIS,
 *     WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *     See the License for the specific language governing permissions and
 *     limitations under the License.
 *
 */
/* global __HIDE_DATA__ */
import _ from 'lodash';
import * as THREE from 'three';
import numeral from 'numeral';

import GlobalDefinitions from '../globalDefinitions';
import GlobalStyles from '../globalStyles';
import NodeView from './nodeView';
import NodeNameView from './nodeNameView';

const Console = console;

const arcMeterWidth = 15;

function generateDisplayValue (value, format) {
  value = value || 0;

  let displayValue = value;
  if (format) { displayValue = numeral(value).format(format); }

  // If we're hiding data, don't need to hide percentages
  if (__HIDE_DATA__ && displayValue.indexOf('%') === -1) {
    displayValue = displayValue.replace(/[0-9]/g, '#');
  }
  return displayValue;
}

const zAxis = new THREE.Vector3(0, 0, 1);

const outerBorderGeometries = {};
function getOuterBorderGeometry (radius) {
  let geometry = outerBorderGeometries[radius];
  if (geometry === undefined) {
    const border = new THREE.Shape();
    border.absarc(0, 0, radius + 2, 0, Math.PI * 2, false);
    const borderHole = new THREE.Path();
    borderHole.absarc(0, 0, radius, 0, Math.PI * 2, true);
    border.holes.push(borderHole);
    geometry = new THREE.ShapeGeometry(border, { curveSegments: 32 });
    outerBorderGeometries[radius] = geometry;
  }
  return geometry;
}

const innerCircleGeometries = {};
function getInnerCircleGeometry (radius) {
  let geometry = innerCircleGeometries[radius];
  if (geometry === undefined) {
    const circleShape = new THREE.Shape();
    circleShape.moveTo(radius, 0);
    circleShape.absarc(0, 0, radius, 0, 2 * Math.PI, false);
    geometry = new THREE.ShapeGeometry(circleShape, { curveSegments: 32 });
    innerCircleGeometries[radius] = geometry;
  }
  return geometry;
}

const innerBorderGeometries = {};
function getInnerBorderGeometry (radius) {
  let geometry = innerBorderGeometries[radius];
  if (geometry === undefined) {
    const innerBorder = new THREE.Shape();
    innerBorder.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const innerBorderHole = new THREE.Path();
    innerBorderHole.absarc(0, 0, radius - 2, 0, Math.PI * 2, true);
    innerBorder.holes.push(innerBorderHole);
    geometry = new THREE.ShapeGeometry(innerBorder, { curveSegments: 32 });
    innerBorderGeometries[radius] = geometry;
  }
  return geometry;
}

const donutGeometries = {};
function getDonutGeometry (radius, innerRadius) {
  const key = `${radius}:${innerRadius}`;
  let geometry = donutGeometries[key];
  if (geometry === undefined) {
    const arcShape = new THREE.Shape();
    arcShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    arcShape.holes.push(holePath);
    geometry = new THREE.ShapeGeometry(arcShape, { curveSegments: 32 });
    donutGeometries[key] = geometry;
  }
  return geometry;
}

class DetailedNodeView extends NodeView {
  constructor (service) {
    super(service);

    this.donutMaterial = new THREE.MeshBasicMaterial({ color: GlobalStyles.styles.colorPageBackground, transparent: true });
    this.innerBorderMaterial = new THREE.MeshBasicMaterial({ color: GlobalStyles.styles.colorPageBackground, transparent: true });
    this.donutGraphSegments = [];
    this.arcMeterSegments = [];

    this.radius = this.object.size || 120;
    this.innerRadius = this.radius * 0.8;

    this.meshes.outerBorder = this.addChildElement(getOuterBorderGeometry(this.radius), this.borderMaterial);
    this.meshes.innerCircle = this.addChildElement(getInnerCircleGeometry(this.radius), this.innerCircleMaterial);
    this.meshes.innerCircle.position.setZ(-10);
    this.meshes.donut = this.addChildElement(getDonutGeometry(this.radius, this.innerRadius), this.donutMaterial, 'donut');
    this.meshes.innerBorder = this.addChildElement(getInnerBorderGeometry(this.innerRadius), this.borderMaterial);
    this.meshes.innerBorder.position.setZ(100);

    // Add the service name
    if (this.object.graphRenderer === 'global' && !this.object.isEntryNode()) {
      this.nameView = new NodeNameView(this, true);
      this.showLabel(this.object.options.showLabel);
    }

    this.canvasWidth = this.innerRadius * 2;
    this.canvasHeight = this.canvasWidth * 0.53;
    this.metricSpacing = this.canvasHeight * 0.1;
    this.headerFontSize = (this.canvasHeight - this.metricSpacing) * 0.2;
    this.metricFontSize = (this.canvasHeight - this.metricSpacing) * 0.3;
    this.addText();

    if (!this.object.loaded) {
      this.setupLoadingAnimation();
    }

    this.updateDetailedMode();

    // check if we have arc meters...
    const hasArcMeter = this.detailed.arc && this.detailed.arc.data;
    if (hasArcMeter) {
      // arc background
      const { mesh } = this.addArcSlice(0, 1, GlobalStyles.styles.colorArcBackground, true);
      this.meshes.arcBackground = mesh;
      this.addInteractiveChild(mesh, 'arc');
    }
  }

  addText () {
    this.textCanvas = this.createCanvas(this.canvasWidth, this.canvasHeight);
    this.textTexture = new THREE.Texture(this.textCanvas);
    this.textTexture.minFilter = THREE.LinearFilter;
    this.textTexture.needsUpdate = true;

    this.textMaterial = new THREE.MeshBasicMaterial({ map: this.textTexture, side: THREE.DoubleSide, transparent: true });
    const text = new THREE.Mesh(new THREE.PlaneBufferGeometry(this.textCanvas.width, this.textCanvas.height), this.textMaterial);
    this.container.add(text);
    this.addInteractiveChild(text);
    text.position.set(0, 0, this.depth + 1);
  }

  updateText () {
    if (!this.textCanvas) {
      Console.warn(`Attempted to update the text in the middle of the ${this.object.name} node before the text was created.`);
      return;
    }
    const textContext = this.textCanvas.getContext('2d');
    const headerWeight = 600;
    const metricWeight = 700;
    let top = 0;

    // Reset the canvas to draw new text
    textContext.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);

    if (this.loaded) {
      let topData;
      let bottomData;
      // Get which text to draw
      if (!this.object.context) {
        // get the default top/bottom
        topData = this.detailed.top;
        bottomData = this.detailed.bottom;
      } else {
        // get the named top/bottom
        topData = this.detailed[this.object.context].top;
        bottomData = this.detailed[this.object.context].bottom;
      }

      // Draw the top header to the canvas
      top += (this.headerFontSize / 2);
      if (topData) {
        textContext.fillStyle = GlobalStyles.styles.colorNormalDimmed;
        textContext.font = `${headerWeight} ${this.headerFontSize}px 'Source Sans Pro', sans-serif`;
        textContext.fillText(topData.header, this.textCanvas.width / 2, top);
      }
      top += (this.headerFontSize / 2);

      // Draw the top metric to the canvas
      top += (this.metricFontSize / 2);
      if (topData) {
        textContext.fillStyle = GlobalStyles.styles.colorTraffic.normal;
        textContext.font = `${metricWeight} ${this.metricFontSize}px 'Source Sans Pro', sans-serif`;
        const topMetricDisplayValue = generateDisplayValue(_.get(this.object, topData.data), topData.format);
        textContext.fillText(topMetricDisplayValue, this.textCanvas.width / 2, top);
      }
      top += (this.metricFontSize / 2);

      // Draw the second header to the canvas
      top += this.metricSpacing + (this.headerFontSize / 2);
      if (bottomData) {
        textContext.fillStyle = GlobalStyles.styles.colorNormalDimmed;
        textContext.font = `${headerWeight} ${this.headerFontSize}px 'Source Sans Pro', sans-serif`;
        textContext.fillText(bottomData.header, this.textCanvas.width / 2, top);
      }
      top += (this.headerFontSize / 2);

      // Draw the second metric to the canvas
      top += (this.metricFontSize / 2);
      if (bottomData) {
        textContext.fillStyle = GlobalStyles.getColorTraffic(this.object.getClass());
        textContext.font = `${metricWeight} ${this.metricFontSize}px 'Source Sans Pro', sans-serif`;
        const bottomMetricDisplayValue = generateDisplayValue(_.get(this.object, bottomData.data), bottomData.format);
        textContext.fillText(bottomMetricDisplayValue, this.textCanvas.width / 2, top);
      }
      top += (this.metricFontSize / 2);
    } else {
      // The node is still loading so show a loading message
      textContext.fillStyle = GlobalStyles.styles.colorTraffic.normal;
      textContext.font = `${metricWeight} ${this.metricFontSize}px 'Source Sans Pro', sans-serif`;
      top = ((this.canvasHeight / 2) - (((this.metricFontSize * 2)) / 2)) + 16;
      textContext.fillText('REGION', this.textCanvas.width / 2, top);
      top += this.metricSpacing + this.headerFontSize;
      textContext.fillText('LOADING', this.textCanvas.width / 2, top);
    }

    // Tell three.js that an update needs to happen
    this.textTexture.needsUpdate = true;
  }

  updateDetailedMode () {
    const override = this.object.isEntryNode() ? 'entry' : undefined;
    const definition = GlobalDefinitions.getDefinition('detailedNode', this.object.detailedMode, this.object.graphRenderer, override);
    this.detailed = definition;
  }

  /**
   * Add a new slice to the donut graph
   *
   * @param {number} startAngle - The angle (in radians) to start drawing the donut slice
   * @param {number} percent - The percent of the donut to fill with this new donut slice
   * @param {string} color - A string representation of the color to make this slice
   */
  addNewDonutSlice (startAngle, percent, color) {
    const size = Math.PI * 2 * percent;
    const slice = new THREE.RingGeometry(this.innerRadius, this.radius, 30, 8, startAngle, size);
    const mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.Mesh(slice, mat);
    mesh.position.set(0, 0, this.depth + 2);
    mesh.rotation.y = Math.PI;

    this.donutGraphSegments.push(mesh);
    this.container.add(mesh);

    return startAngle + size;
  }

  /**
   * Update the donut graph if there is updated information to be rendered or if the donut graph
   * represents a new set of data
   */
  updateDonutGraph () {
    const entryConnections = _.filter(this.object.incomingConnections, c => c.source.isEntryNode());
    /**
     * Get the start angle of the donut graph based on the totalPercent of the donut to be filled
     *
     * @param {number} totalPercent - A percent in decimal form between 0 and 1
     */
    const getStartAngle = (totalPercent) => {
      let startAngle = Math.PI * 0.5;
      if (totalPercent < 1 && entryConnections && entryConnections.length === 1) {
        const incomingNodePosition = entryConnections[0].source.position;
        // start angle is a function of percent and angle of incoming connection
        const x = incomingNodePosition.x - this.object.position.x;
        const y = incomingNodePosition.y - this.object.position.y;
        startAngle = Math.atan2(y, x);
        startAngle += (totalPercent * 2 * Math.PI) / 2;
        startAngle = Math.PI - startAngle;
      }

      return startAngle;
    };

    if (this.loaded) {
      // Remove the old donut segments
      _.each(this.donutGraphSegments, segment => this.container.remove(segment));
      this.donutGraphSegments.length = 0;

      const donutData = _.get(this.object, this.detailed.donut.data, undefined);
      const donutIndices = _.get(this.detailed, ['donut', 'indices'], undefined);
      if (donutIndices) {
        const totalPercent = _.sum(_.map(donutIndices, i => donutData[i.key] || 0));
        let startAngle = getStartAngle(totalPercent);
        // add donut slices
        _.each(donutIndices, (index) => {
          if (donutData[index.key] !== undefined) {
            const colorKey = index.class || index.key;
            startAngle = this.addNewDonutSlice(startAngle, donutData[index.key], GlobalStyles.getColorTraffic(colorKey));
          }
        });
      } else {
        const totalPercent = _.sum(_.map(donutData));
        let startAngle = getStartAngle(totalPercent);
        // add donut slices
        _.each(donutData, (classPercent, key) => {
          const colorKey = _.get(this.detailed, ['donut', 'classes', key], key);
          startAngle = this.addNewDonutSlice(startAngle, classPercent, GlobalStyles.getColorTraffic(colorKey));
        });
      }
    }
  }

  /**
   * Add a new slice to the arc meter
   *
   * @param {number} startAngle - The angle (in radians) to start drawing the arc slice
   * @param {number} percent - The percent of the arc to fill with this new arc slice
   * @param {string} color - A string representation of the color to make this slice
   * @param {boolean=} permanent - Whether to include this slice permanently (Added for the use of the background color slice)
   */
  addArcSlice (startAngle, percent, color, permanent) {
    const size = Math.PI * percent;
    const slice = new THREE.RingGeometry(this.innerRadius - arcMeterWidth, this.innerRadius - 1, 30, 8, startAngle, size);
    const mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.Mesh(slice, mat);
    mesh.position.set(0, 0, this.depth + 5);
    mesh.rotation.y = Math.PI;
    mesh.userData.type = 'arc';

    if (!permanent) { this.arcMeterSegments.push(mesh); }
    this.container.add(mesh);

    return { mesh: mesh, angle: startAngle + size };
  }

  updateArcMeter () {
    let startAngle = 0;

    if (this.loaded) {
      // remove the old arc segments
      _.each(this.arcMeterSegments, segment => this.container.remove(segment));
      this.arcMeterSegments.length = 0;

      const arcData = _.get(this.object, this.detailed.arc.data, undefined);
      if (arcData) {
        // arc slices
        _.each(arcData.values, value => {
          const percent = value.value / arcData.total;
          const colorKey = value.class || value.name;
          const { angle } = this.addArcSlice(startAngle, percent, GlobalStyles.getColorTraffic(colorKey), false);
          startAngle = angle;
        });

        // mark
        let line = _.get(arcData, this.detailed.arc.lineIndex, undefined);
        if (line) {
          let lineColor = GlobalStyles.styles.colorDonutInternalColor;
          // figure out color of line
          if (line >= 1) {
            line = 1;
            lineColor = GlobalStyles.styles.colorTraffic.normal;
          }
          // line
          const linePosition = (Math.PI * line) - 0.01;
          startAngle = linePosition;
          this.addArcSlice(startAngle, 0.0075, lineColor, false);
          const startingX = 1;
          // arrow
          const triangleShape = new THREE.Shape();
          const trianglePointRadius = this.innerRadius - arcMeterWidth - 1;
          const triangleSize = arcMeterWidth * 0.75;
          const triangleWidth = triangleSize * 0.5;
          triangleShape.moveTo(startingX, trianglePointRadius);
          triangleShape.lineTo(startingX - triangleWidth, trianglePointRadius - triangleSize);
          triangleShape.lineTo(startingX + triangleWidth, trianglePointRadius - triangleSize);
          triangleShape.lineTo(startingX, trianglePointRadius);
          const triangleGeometry = new THREE.ShapeGeometry(triangleShape);
          const triangleMaterial = new THREE.MeshBasicMaterial({ color: GlobalStyles.styles.colorTraffic.normal, side: THREE.DoubleSide, transparent: true });

          const triangleMesh = new THREE.Mesh(triangleGeometry, triangleMaterial);
          triangleMesh.position.set(0, 0, this.depth + 3);
          triangleMesh.rotateZ((Math.PI * 2) - (linePosition - (Math.PI / 2)));
          this.arcMeterSegments.push(triangleMesh);
          this.container.add(triangleMesh);
        }
      }
    }
  }

  setOpacity (opacity) {
    super.setOpacity(opacity);
    this.donutMaterial.opacity = opacity;
    this.innerCircleMaterial.opacity = opacity;
    this.textMaterial.opacity = opacity;

    _.each(this.donutGraphSegments, segment => {
      segment.material.opacity = opacity;
    });

    _.each(this.arcMeterSegments, segment => {
      segment.material.opacity = opacity;
    });
  }

  setupLoadingAnimation () {
    const slice = new THREE.RingGeometry(this.innerRadius, this.radius, 30, 8, 0, Math.PI * 2 * 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: GlobalStyles.styles.colorTraffic.normal, side: THREE.DoubleSide });
    this.loadingSpinner = new THREE.Mesh(slice, mat);
    this.loadingSpinner.position.set(0, 0, this.depth + 2);
    this.container.add(this.loadingSpinner);
    this.refresh(true);
  }

  clearLoadingAnimation () {
    // Reset the spinner rotation to 0
    this.loadingSpinner.quaternion.set(0, 0, 0, 1);
    // Switch off the loading spinner
    this.container.remove(this.loadingSpinner);

    this.refresh(true);
  }

  refresh (force) {
    this.updateDetailedMode();
    super.refresh(force);
    this.updateText();
    this.updateDonutGraph();
    this.updateArcMeter();
  }

  update () {
    if (this.loaded !== this.object.loaded) {
      this.loaded = this.object.loaded;
      // If things are done loading, turn off the loading animation
      if (this.loaded) {
        this.clearLoadingAnimation();
      }
    }

    // If things are still loading, rotate the circle
    if (!this.loaded) {
      this.loadingSpinner.rotateOnAxis(zAxis, -0.05);
    }

    if (this.object.updated) {
      this.object.updated = false;
      this.refresh(true);
    }
  }

  cleanup () {
    super.cleanup();
    this.donutMaterial.dispose();
    this.innerBorderMaterial.dispose();
  }
}

export default DetailedNodeView;

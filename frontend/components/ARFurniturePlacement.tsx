/**
 * AR Furniture Placement Component
 * Handles placement and rendering of furniture in AR view over live camera
 */

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, PanResponder, Dimensions } from 'react-native';
import * as THREE from 'three';
import { GLView } from 'expo-gl';
import { FurnitureModelLoader } from '@/services/FurnitureModelLoader';
import type { ARFurnitureItem } from './ARFurnitureRenderer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Shared loader instance
const modelLoader = new FurnitureModelLoader();

/** A furniture item placed relative to the layout center, in meters. */
export interface ARLayoutItem extends ARFurnitureItem {
  offset: { x: number; z: number };
}

export interface ARFurniturePlacementHandle {
  resetTransform: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
}

interface Props {
  furnitureItem: ARFurnitureItem | null;
  /** When set, the whole arrangement is placed and moved as one group instead of furnitureItem. */
  layoutItems?: ARLayoutItem[] | null;
  onLoadingStateChange?: (isLoading: boolean) => void;
  onError?: (error: string) => void;
}

async function createFurnitureModel(furnitureItem: ARFurnitureItem): Promise<THREE.Object3D | null> {
  if (furnitureItem.modelUrl) {
    const model = await modelLoader.loadGLBModel(furnitureItem.modelUrl, 1.0);
    if (model) {
      // Normalization
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());

      // Apply scale
      const scaleX = furnitureItem.dimensions.width / size.x;
      const scaleY = furnitureItem.dimensions.height / size.y;
      const scaleZ = furnitureItem.dimensions.depth / size.z;
      const uniformScale = Math.min(scaleX, scaleY, scaleZ);

      if (uniformScale > 0 && uniformScale !== Infinity) {
        model.scale.multiplyScalar(uniformScale);
      }

      // Center and set bottom to y=0
      box.setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.position.y += box.getSize(new THREE.Vector3()).y / 2;
    }
    return model;
  }

  // Use procedural generation instead of loading broken remote models
  const category = furnitureItem.id.includes('sofa') ? 'seating' :
                   furnitureItem.id.includes('table') ? 'tables' :
                   furnitureItem.id.includes('book') ? 'storage' : 'seating';

  return modelLoader.createDetailedFurnitureModel({
    id: furnitureItem.id,
    name: furnitureItem.name,
    category: category,
    dimensions: {
      width: furnitureItem.dimensions.width,
      length: furnitureItem.dimensions.depth,
      height: furnitureItem.dimensions.height,
    },
    price: '', // Required by the library type; not used for rendering
    color: furnitureItem.color ? '#' + furnitureItem.color.toString(16).padStart(6, '0') : '#808080'
  });
}

export const ARFurniturePlacement = forwardRef<ARFurniturePlacementHandle, Props>(({
  furnitureItem,
  layoutItems,
  onLoadingStateChange,
  onError
}, ref) => {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // 3D Objects
  const groundPlaneRef = useRef<THREE.Mesh | null>(null);
  const furnitureGroupRef = useRef<THREE.Group | null>(null);
  const shadowMeshRef = useRef<THREE.Mesh | null>(null);
  const rotationRingRef = useRef<THREE.Group | null>(null);

  // Transform state (persisted in refs to avoid re-renders during gestures)
  const transformRef = useRef({
    position: new THREE.Vector3(0, 0, -2.5), // Default 2.5 meters in front
    scale: 1.0,
    rotationY: 0,
  });

  // Gesture state
  const gestureStateRef = useRef({
    isDragging: false,
    isPinching: false,
    isRotatingRing: false,
    initialPinchDistance: 0,
    initialScale: 1.0,
    initialRotationAngle: 0,
    initialRotationY: 0,
    lastTouchVector: new THREE.Vector2(),
  });

  // Dragging plane references to keep size constant
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useImperativeHandle(ref, () => ({
    resetTransform: () => {
      transformRef.current = {
        position: new THREE.Vector3(0, 0, -2.5),
        scale: 1.0,
        rotationY: 0,
      };
      updateFurnitureTransform();
    },
    rotateLeft: () => {
      transformRef.current.rotationY += Math.PI / 4; // 45 degrees
      updateFurnitureTransform();
    },
    rotateRight: () => {
      transformRef.current.rotationY -= Math.PI / 4; // 45 degrees
      updateFurnitureTransform();
    }
  }));

  // Update object transform
  const updateFurnitureTransform = () => {
    if (furnitureGroupRef.current) {
      furnitureGroupRef.current.position.copy(transformRef.current.position);
      furnitureGroupRef.current.scale.setScalar(transformRef.current.scale);
      furnitureGroupRef.current.rotation.y = transformRef.current.rotationY;
      
      // Update shadow position to follow object but stay on ground
      if (shadowMeshRef.current) {
        shadowMeshRef.current.position.x = transformRef.current.position.x;
        shadowMeshRef.current.position.z = transformRef.current.position.z;
        shadowMeshRef.current.scale.setScalar(transformRef.current.scale);
      }
      
      if (rotationRingRef.current) {
        rotationRingRef.current.position.x = transformRef.current.position.x;
        rotationRingRef.current.position.z = transformRef.current.position.z;
        rotationRingRef.current.scale.setScalar(transformRef.current.scale);
      }
    }
  };

  // Setup WebGL Context
  const onContextCreate = async (gl: any) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;

    // Create scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 1.5, 0); // Camera at roughly eye level (1.5m)
    camera.lookAt(0, 1.0, -5);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      context: gl,
      alpha: true, // Transparent background
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(gl.drawingBufferWidth / gl.drawingBufferWidth);
    renderer.setClearColor(0x000000, 0); // Transparent
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // Invisible ground plane for raycasting
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshBasicMaterial({ visible: false }); 
    const groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2; // Lie flat
    groundPlane.position.y = 0; // Ground level
    scene.add(groundPlane);
    groundPlaneRef.current = groundPlane;

    // Fake drop shadow
    const shadowGeo = new THREE.CircleGeometry(0.8, 32);
    const shadowMat = new THREE.MeshBasicMaterial({ 
      color: 0x000000, 
      transparent: true, 
      opacity: 0.25,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01; // Slightly above ground
    shadowMesh.visible = false;
    scene.add(shadowMesh);
    shadowMeshRef.current = shadowMesh;

    // 3D Rotation Ring
    const ringGroup = new THREE.Group();
    ringGroup.position.y = 0.02; // Slightly above shadow
    
    // Visible ring
    const ringGeo = new THREE.RingGeometry(1.0, 1.15, 64);
    const ringMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0.6,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringGroup.add(ringMesh);

    // Add arrow indicators on the ring
    const coneGeo = new THREE.ConeGeometry(0.12, 0.3, 16);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    
    const cone1 = new THREE.Mesh(coneGeo, coneMat);
    cone1.position.set(1.075, 0, 0); // Position exactly on the ring
    cone1.rotation.x = -Math.PI / 2;
    ringGroup.add(cone1);

    const cone2 = new THREE.Mesh(coneGeo, coneMat);
    cone2.position.set(-1.075, 0, 0);
    cone2.rotation.x = -Math.PI / 2;
    cone2.rotation.z = Math.PI;
    ringGroup.add(cone2);

    // Invisible larger ring for easy hit detection
    const hitGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.rotation.x = -Math.PI / 2;
    // Mark as hit target
    hitMesh.name = 'rotationRingHitArea';
    ringGroup.add(hitMesh);

    ringGroup.visible = false;
    scene.add(ringGroup);
    rotationRingRef.current = ringGroup;

    // Main group for furniture
    const furnitureGroup = new THREE.Group();
    scene.add(furnitureGroup);
    furnitureGroupRef.current = furnitureGroup;
    updateFurnitureTransform();

    // Render loop
    const render = () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        gl.endFrameEXP();
      }
      animationFrameRef.current = requestAnimationFrame(render);
    };
    render();
  };

  // Load furniture model when item changes
  useEffect(() => {
    const items: ARLayoutItem[] = layoutItems?.length
      ? layoutItems
      : furnitureItem ? [{ ...furnitureItem, offset: { x: 0, z: 0 } }] : [];
    if (!items.length) {
      if (furnitureGroupRef.current) {
         while (furnitureGroupRef.current.children.length > 0) {
           furnitureGroupRef.current.remove(furnitureGroupRef.current.children[0]);
         }
      }
      if (shadowMeshRef.current) shadowMeshRef.current.visible = false;
      return;
    }

    let isMounted = true;

    const loadModel = async () => {
      onLoadingStateChange?.(true);
      
      // Wait for scene to be ready
      while (!furnitureGroupRef.current && isMounted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!isMounted) return;

      // Clear existing model
      while (furnitureGroupRef.current!.children.length > 0) {
        const child = furnitureGroupRef.current!.children[0];
        furnitureGroupRef.current!.remove(child);
      }

      try {
        let loadedCount = 0;
        for (const item of items) {
          const model = await createFurnitureModel(item);
          if (!isMounted) return;
          if (model) {
            model.position.x += item.offset.x;
            model.position.z += item.offset.z;
            furnitureGroupRef.current!.add(model);
            loadedCount++;
          }
        }

        if (loadedCount > 0) {
          shadowMeshRef.current!.visible = !layoutItems?.length;
          updateFurnitureTransform();
          if (loadedCount < items.length) {
            onError?.(`${items.length - loadedCount} of ${items.length} items could not be loaded.`);
          }
        } else {
          onError?.('Failed to load 3D model.');
          shadowMeshRef.current!.visible = false;
        }
      } catch (err: any) {
        if (isMounted) {
          onError?.(err.message || 'Error loading model');
          shadowMeshRef.current!.visible = false;
        }
      } finally {
        if (isMounted) {
          onLoadingStateChange?.(false);
        }
      }
    };

    loadModel();

    return () => {
      isMounted = false;
    };
  }, [furnitureItem, layoutItems]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sceneRef.current) {
        sceneRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (object.material instanceof Array) {
              object.material.forEach(m => m.dispose());
            } else {
              object.material.dispose();
            }
          }
        });
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        // @ts-ignore
        if (rendererRef.current.forceContextLoss) rendererRef.current.forceContextLoss();
      }
    };
  }, []);

  // PanResponder for gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        const state = gestureStateRef.current;
        
        if (touches.length === 1) {
          state.isDragging = false;
          state.isRotatingRing = false;

          const touchX = touches[0].locationX;
          const touchY = touches[0].locationY;
          const ndcX = (touchX / SCREEN_WIDTH) * 2 - 1;
          const ndcY = -(touchY / SCREEN_HEIGHT) * 2 + 1;
          
          const raycaster = new THREE.Raycaster();
          if (cameraRef.current) {
            raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);

            // 1. Check if the user is touching the rotation ring
            if (rotationRingRef.current && rotationRingRef.current.visible) {
              const ringIntersects = raycaster.intersectObject(rotationRingRef.current, true);
              if (ringIntersects.length > 0 && groundPlaneRef.current) {
                // Find hit point on ground plane to calculate angle
                const groundIntersects = raycaster.intersectObject(groundPlaneRef.current);
                if (groundIntersects.length > 0) {
                  state.isRotatingRing = true;
                  const hit = groundIntersects[0].point;
                  state.initialRotationAngle = Math.atan2(
                    hit.z - transformRef.current.position.z, 
                    hit.x - transformRef.current.position.x
                  );
                  state.initialRotationY = transformRef.current.rotationY;
                  return; // Skip normal dragging
                }
              }
            }

            // 2. Setup normal dragging on a plane facing the camera
            state.isDragging = true;
            if (furnitureGroupRef.current) {
              const normal = new THREE.Vector3();
              cameraRef.current.getWorldDirection(normal).negate();
              dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, furnitureGroupRef.current.position);
              
              const intersect = new THREE.Vector3();
              raycaster.ray.intersectPlane(dragPlaneRef.current, intersect);
              if (intersect) {
                dragOffsetRef.current.copy(furnitureGroupRef.current.position).sub(intersect);
              } else {
                dragOffsetRef.current.set(0, 0, 0);
              }
            }
          }
        } else if (touches.length === 2) {
          state.isDragging = false;
          state.isRotatingRing = false;
          state.isPinching = true;
          
          const dx = touches[0].locationX - touches[1].locationX;
          const dy = touches[0].locationY - touches[1].locationY;
          state.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
          state.initialScale = transformRef.current.scale;
          
          state.initialRotationAngle = Math.atan2(dy, dx);
          state.initialRotationY = transformRef.current.rotationY;
        }
      },
      
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        const state = gestureStateRef.current;
        const transform = transformRef.current;
        
        if (!cameraRef.current || !groundPlaneRef.current || !furnitureGroupRef.current) return;

        if (touches.length === 1 && state.isRotatingRing) {
          const touchX = touches[0].locationX;
          const touchY = touches[0].locationY;
          const ndcX = (touchX / SCREEN_WIDTH) * 2 - 1;
          const ndcY = -(touchY / SCREEN_HEIGHT) * 2 + 1;
          
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);
          
          const intersects = raycaster.intersectObject(groundPlaneRef.current);
          if (intersects.length > 0) {
             const hit = intersects[0].point;
             const angle = Math.atan2(hit.z - transform.position.z, hit.x - transform.position.x);
             const deltaAngle = angle - state.initialRotationAngle;
             // Update rotation
             transform.rotationY = state.initialRotationY - deltaAngle;
             
             // Rotate the ring visual slightly to feel interactive
             if (rotationRingRef.current) {
                rotationRingRef.current.rotation.z = -deltaAngle; // ring lies flat, Z is its rotation axis
             }
             
             updateFurnitureTransform();
          }
        } else if (touches.length === 1 && state.isDragging) {
          // Raycast to drag on camera-facing plane (keeps size constant!)
          const touchX = touches[0].locationX;
          const touchY = touches[0].locationY;
          
          const ndcX = (touchX / SCREEN_WIDTH) * 2 - 1;
          const ndcY = -(touchY / SCREEN_HEIGHT) * 2 + 1;
          
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);
          
          const intersect = new THREE.Vector3();
          raycaster.ray.intersectPlane(dragPlaneRef.current, intersect);
          
          if (intersect) {
            // Apply offset so object doesn't snap to finger center
            intersect.add(dragOffsetRef.current);
            
            transform.position.copy(intersect);
            
            // We don't limit bounds aggressively here because it's clamped to camera distance
            updateFurnitureTransform();
          }
        } else if (touches.length === 2 && state.isPinching) {
          // Handle Scale and Rotation
          const dx = touches[0].locationX - touches[1].locationX;
          const dy = touches[0].locationY - touches[1].locationY;
          
          // Scale
          const distance = Math.sqrt(dx * dx + dy * dy);
          const scaleFactor = distance / state.initialPinchDistance;
          let newScale = state.initialScale * scaleFactor;
          
          // Clamp scale
          newScale = Math.max(0.25, Math.min(newScale, 3.0));
          transform.scale = newScale;
          
          // Rotation
          const angle = Math.atan2(dy, dx);
          const angleDiff = angle - state.initialRotationAngle;
          // Reverse angle diff to match natural feeling
          transform.rotationY = state.initialRotationY - angleDiff;
          
          updateFurnitureTransform();
        }
      },
      
      onPanResponderRelease: () => {
        const state = gestureStateRef.current;
        state.isDragging = false;
        state.isPinching = false;
      },
      onPanResponderTerminate: () => {
        const state = gestureStateRef.current;
        state.isDragging = false;
        state.isPinching = false;
      }
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <GLView
        style={styles.glView}
        onContextCreate={onContextCreate}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  glView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

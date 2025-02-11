"use client"

import * as THREE from 'three'
import * as React from 'react'
import { useEffect, useState, useRef, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CityJSONParser, CityJSONLoader, CityObjectsMesh } from 'cityjson-threejs-loader'
import { PointerLockControls, PerspectiveCamera, PointerLockControlsProps } from '@react-three/drei'
import { fetchWithProgress } from '@/libs/fetch_with_progress'
import { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib';

/* 
TODO: 道路の色を変えるには、以下を実装。
attributeのtypeが==13 (または ==0 のどっちかだと思う) なら、
diffuse_ の色を objectid をもとに決定可能にする。(できるんか？)
外部データからデータ読んでobjectidと突き合わせるのはのは別の仕事になりそう
*/

const myVertexShader = `
uniform vec3 objectColors[OBJCOLOR_COUNT];
uniform vec3 highlightColor;
uniform float highlightedObjId;

attribute float objectid;
attribute float objectintensity;
attribute int type;

varying vec3 diffuse_;

#ifdef SHOW_SEMANTICS
uniform vec3 surfaceColors[SEMANTIC_COUNT];
attribute int surfacetype;
#endif

#ifdef COLOR_ATTRIBUTE
uniform vec3 attributeColors[ATTRIBUTE_COUNT];
attribute int attributevalue;
#endif

#ifdef SELECT_SURFACE
uniform float highlightedGeomId;
uniform float highlightedBoundId;
attribute float geometryid;
attribute float boundaryid;
#endif

#ifdef SHOW_LOD
uniform float showLod;
attribute float lodid;
varying float discard_;
#endif

#ifdef MATERIAL_THEME
struct CityMaterial {
	vec3 diffuseColor;
	vec3 emissiveColor;
	vec3 specularColor;
};
uniform CityMaterial cityMaterials[MATERIAL_COUNT];
varying vec3 emissive_;
attribute int MATERIAL_THEME;
#endif

#ifdef TEXTURE_THEME
attribute int TEXTURE_THEME;
attribute vec2 TEXTURE_THEME_UV;
flat out int vTexIndex;
varying vec2 vTexUV;
#endif

#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = -mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>

	#ifdef SHOW_SEMANTICS
	diffuse_ = surfacetype > -1 ? surfaceColors[surfacetype] : objectColors[type];
	#else
	diffuse_ = objectColors[type];
	#endif

	#ifdef COLOR_ATTRIBUTE
	diffuse_ = attributevalue > -1 ? attributeColors[attributevalue] : vec3(0.0, 0.0, 0.0);
	#endif

	#ifdef MATERIAL_THEME
	if (MATERIAL_THEME > -1) {
		diffuse_ = cityMaterials[MATERIAL_THEME].diffuseColor;
		emissive_ = cityMaterials[MATERIAL_THEME].emissiveColor;
	}
	#endif

	#ifdef TEXTURE_THEME
	vTexIndex = TEXTURE_THEME;
	vTexUV = TEXTURE_THEME_UV;
	if (vTexIndex > -1) {
		diffuse_ = vec3(1.0, 1.0, 1.0);
	}
	#endif

	#ifdef SELECT_SURFACE
	diffuse_ = abs(objectid - highlightedObjId) < 0.5 && abs(geometryid - highlightedGeomId) < 0.5 && abs(boundaryid - highlightedBoundId) < 0.5 ? highlightColor : diffuse_;
	#else
	//diffuse_ = abs(objectid - highlightedObjId) < 0.5 ? highlightColor : diffuse_;
	// 0 -> 1 の値
	diffuse_ = mix(vec3(0.3, 0.3, 0.3), vec3(1.0, 0.0, 0.0), objectintensity);
  #endif

	#ifdef SHOW_LOD
	if (abs(lodid - showLod) > 0.5) {
		discard_ = 1.0;
	}
	#endif
}
`;

const myFragmentShader = `
varying vec3 diffuse_;
varying float discard_;

#ifdef TEXTURE_THEME
uniform sampler2D cityTexture;
flat in int vTexIndex;
varying vec2 vTexUV;
#endif

#ifdef MATERIAL_THEME
varying vec3 emissive_;
#endif

#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {
	vec4 diffuseColor = vec4(diffuse_, opacity);

	#ifdef TEXTURE_THEME
	if (vTexIndex > -1) {
		vec4 tempDiffuseColor = vec4(1.0, 1.0, 1.0, 0.0);
		tempDiffuseColor = texture2D(cityTexture, vTexUV);
		diffuseColor *= tempDiffuseColor;
	}
	#endif

	#ifdef SHOW_LOD
	if (discard_ > 0.0) {
		discard;
	}
	#endif

	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));

	#ifdef MATERIAL_THEME
	vec3 totalEmissiveRadiance = emissive_;
	#else
	vec3 totalEmissiveRadiance = emissive;
	#endif

	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}
`;

function UpdateColors({ data, objectPositionMapping }: { data: THREE.Group, objectPositionMapping: { [key: number]: THREE.Vector3 } }) {
	const objectintensityUpdateClock = useRef(0);
	const camera = useThree((state) => state.camera);

	// objectPositionMappingを直接使って最初に計算する
	const objAreas = useMemo(() => {
		const res: { [key: number]: [boolean, number] } = {};
		for (const key of Object.keys(objectPositionMapping)) {
			// [訪問中か？, 訪問回数]
			res[Number(key)] = [false, 0];
		}
		return res;
	}, [objectPositionMapping]);

	useFrame(({ clock }) => {
		if (clock.elapsedTime - objectintensityUpdateClock.current > 2) {
			console.log("Update!!")
			for (const objId in objAreas) {
				if (!(objId in objectPositionMapping)) continue;

				const cp = camera.position
				const opmp = objectPositionMapping[objId]
				const distanceSq = (cp.x - opmp.x) * (cp.x - opmp.x) + (cp.y - opmp.y) * (cp.y - opmp.y);
				if (distanceSq < 50 * 50) {
					if (!objAreas[objId][0]) {
						console.log(`${camera.position.x}, ${camera.position.y}, ${camera.position.z} ${objectPositionMapping[objId].x}, ${objectPositionMapping[objId].y}, ${objectPositionMapping[objId].z}`)
						objAreas[objId][0] = true;
						objAreas[objId][1] += 1;
					}
				} else if (distanceSq > 80 * 80) {
					objAreas[objId][0] = false;
				}
			}

			// data.traverseの最適化：必要な情報だけをキャッシュしておく
			data.traverse((o) => {
				if ((o as CityObjectsMesh).isMesh && (o as CityObjectsMesh).geometry) {
					const oCOM = o as CityObjectsMesh;
					const objIds = oCOM.geometry.getAttribute("objectid");
					const objIntensity = oCOM.geometry.getAttribute("objectintensity");

					if (objIds && objIntensity) {
						const objIdArray = objIds.array;
						const objIntensityArray = objIntensity.array;

						for (let i = 0; i < objIds.count; i++) {
							const id = objIdArray[i];
							objIntensityArray[i] = Math.min(1, objAreas[id][1] / 5);
						}
						objIntensity.needsUpdate = true;
					}
				}
			});

			objectintensityUpdateClock.current = clock.elapsedTime; // 最後に実行した時間を更新
		}
	});

	return <></>;
}

function CameraController() {
	const cameraRef = useRef<THREE.PerspectiveCamera>(null);

	// 移動 & 回転情報を格納
	const movement = useRef({ forward: 0, right: 0 });
	const rotation = useRef({ yaw: 0, pitch: 0 });

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			switch (event.code) {
				// カメラ移動（矢印キー）
				case "ArrowUp":
					movement.current.forward = 1;
					break;
				case "ArrowDown":
					movement.current.forward = -1;
					break;
				case "ArrowLeft":
					movement.current.right = -1;
					break;
				case "ArrowRight":
					movement.current.right = 1;
					break;
				// カメラ回転（WASD）
				case "KeyA":
					rotation.current.yaw = -1; // 左回転
					break;
				case "KeyD":
					rotation.current.yaw = 1; // 右回転
					break;
				case "KeyW":
					rotation.current.pitch = -1; // 上向き
					break;
				case "KeyS":
					rotation.current.pitch = 1; // 下向き
					break;
			}
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			switch (event.code) {
				case "ArrowUp":
				case "ArrowDown":
					movement.current.forward = 0;
					break;
				case "ArrowLeft":
				case "ArrowRight":
					movement.current.right = 0;
					break;
				case "KeyA":
				case "KeyD":
					rotation.current.yaw = 0;
					break;
				case "KeyW":
				case "KeyS":
					rotation.current.pitch = 0;
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
		};
	}, []);

	useFrame(() => {
		if (cameraRef.current) {
			const speed = 2;
			const rotateSpeed = 0.02;

			const quaternion = cameraRef.current.quaternion;
			const euler = new THREE.Euler().setFromQuaternion(quaternion, "ZXY");

			// Z 軸が上向きの座標系に適応
			const direction = new THREE.Vector3(0, 0, -1); // 初期向き X 軸
			direction.applyQuaternion(quaternion);
			direction.z = 0; // 移動は XY 平面に制限
			direction.normalize();

			const right = new THREE.Vector3();
			right.crossVectors(direction, new THREE.Vector3(0, 0, 1)).normalize();

			const move = new THREE.Vector3()
				.addScaledVector(direction, movement.current.forward * speed)
				.addScaledVector(right, movement.current.right * speed);

			cameraRef.current.position.add(move);

			// Z 軸を上方向に保ちつつ回転処理
			euler.z -= rotation.current.yaw * rotateSpeed;
			euler.x -= rotation.current.pitch * rotateSpeed;
			euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 4, Math.PI / 2);

			cameraRef.current.quaternion.setFromEuler(euler);
		}
	});

	return <PerspectiveCamera
		makeDefault
		ref={cameraRef}
		position={[0, 0, -25]}
		rotation={[Math.PI / 2, 0, 0]}
		up={[0, 0, 1]}
	/>;
}

export default function Home() {
	const [fetchProgress, setFetchProgress] = useState(0);
	const [loadedData, setLoadedData] = useState<null | THREE.Group>(null);

	const objectPositionMapping = useMemo(() => {
		const averages: { [key: number]: THREE.Vector3 } = {};
		loadedData?.traverse(o => {
			if ((o as CityObjectsMesh).isMesh && (o as CityObjectsMesh).geometry) {
				const oCOM = o as CityObjectsMesh
				const geometry = oCOM.geometry;
				const positions = geometry.attributes.position.array;
				const objectIds = geometry.attributes.objectid.array;

				// 各 objectid ごとの座標の合計とカウントを保持するためのオブジェクト
				const positionSums: { [key: number]: THREE.Vector3 } = {};
				const objectCounts: { [key: number]: number } = {};

				// 頂点をループして、各 objectid の座標の合計を計算
				for (let i = 0; i < positions.length; i += 3) {
					const objectId = objectIds[i / 3 | 0];
					const x = positions[i];
					const y = positions[i + 1];
					const z = positions[i + 2];

					// 初めての objectid なら初期化
					if (!positionSums[objectId]) {
						positionSums[objectId] = new THREE.Vector3(0, 0, 0);
						objectCounts[objectId] = 0;
					}

					// 合計を更新
					positionSums[objectId].add(new THREE.Vector3(x, y, z));
					objectCounts[objectId] += 1;
				}

				// 各 objectid ごとに平均座標を計算
				for (const objectId in positionSums) {
					const sum = positionSums[objectId];
					const count = objectCounts[objectId];
					const average = sum.divideScalar(count);
					averages[objectId] = average;
				}
			}
		});
		return averages;
	}, [loadedData])

	useEffect(() => {
		const parser = new CityJSONParser();
		const loader = new CityJSONLoader(parser);

		fetchWithProgress("/toyohashi_sta.city.json", progress => {
			setFetchProgress(progress)
		})
			.then((r) => {
				if (r.ok) { return r.json() }
				else { throw new Error("json cannot be loaded") }
			})
			.then((j) => { console.log("json loaded!"); return loader.load(j) })
			.then(() => {
				console.log("loaded!");
				const firstChild = (loader.scene.children[0] as CityObjectsMesh)
				const firstChildGeometry = (firstChild.geometry as THREE.BufferGeometry);

				firstChildGeometry.computeBoundingSphere();
				const center = firstChildGeometry.boundingSphere!.center.clone()
				loader.scene.traverse((o) => {
					if ((o as CityObjectsMesh).isMesh && (o as CityObjectsMesh).geometry) {
						const oCOM = o as CityObjectsMesh
						oCOM.geometry.setAttribute(
							"objectintensity",
							new THREE.Float32BufferAttribute(
								new Float32Array(oCOM.geometry.getAttribute("objectid").count),
								1
							)
						);
						(oCOM.material as THREE.ShaderMaterial).vertexShader = myVertexShader;
						(oCOM.material as THREE.ShaderMaterial).fragmentShader = myFragmentShader;
						const position = (oCOM.geometry as THREE.BufferGeometry).getAttribute("position");
						const array = position.array;
						for (let i = 0; i < array.length; i += 3) {
							array[i] -= center.x;     // X 座標を移動
							array[i + 1] -= center.y; // Y 座標を移動
							array[i + 2] -= center.z; // Z 座標を移動
						}

						position.needsUpdate = true; // 更新フラグを立てる
						// 強制的に再計算させる
						oCOM.geometry.computeBoundingSphere();
					}
				})

				setLoadedData(loader.scene)
			})
			.catch((reason) => console.error(reason));
	}, [])

	return (
		<div style={{ width: "100%", height: "100%" }}>
			<div style={{ display: loadedData == null ? "block" : "none" }}>Loading...{fetchProgress}</div>
			<Canvas style={{ width: "100%", height: "100%", display: loadedData != null ? "block" : "none" }}>
				{loadedData && <UpdateColors data={loadedData} objectPositionMapping={objectPositionMapping} />}
				<CameraController />
				<color attach="background" args={["white"]} />
				<ambientLight intensity={2} />
				{loadedData && <primitive object={loadedData} />}
			</Canvas>
		</div>
	)
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
const vs = `#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
  varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

uniform float time;
uniform vec4 inputData;
uniform vec4 outputData;
uniform vec4 cameraData;

// Function to displace a vertex along its normal
vec3 displace(vec3 pos, vec3 norm) {
  float displacement = 
    0.3 * inputData.x * (.5 + .5 * sin(pos.y * inputData.z + time)) +
    0.3 * outputData.x * (.5 + .5 * sin(pos.x * outputData.z + time)) +
    0.5 * cameraData.x * (.5 + .5 * sin(pos.z * 20.0 * (cameraData.y + 0.1) + time));
  return pos + norm * displacement;
}

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

  // Displace the vertex
  transformed = displace(position, normal);

  // Recalculate normals for correct lighting using finite differences
  float epsilon = 0.001;
  // Create a tangent and bitangent to find neighboring points
  vec3 tangent = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));
  if (length(tangent) < 1e-5) {
      tangent = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
  }
  vec3 bitangent = normalize(cross(normal, tangent));

  // Displace neighboring points
  vec3 neighbor1 = position + tangent * epsilon;
  vec3 neighbor2 = position + bitangent * epsilon;
  
  // Assuming normal is locally constant for the neighbors before displacement
  vec3 displacedNeighbor1 = displace(neighbor1, normal);
  vec3 displacedNeighbor2 = displace(neighbor2, normal);

  // Recalculate tangent and bitangent in displaced space
  vec3 displacedTangent = displacedNeighbor1 - transformed;
  vec3 displacedBitangent = displacedNeighbor2 - transformed;

  // New normal is the cross product of the displaced tangent and bitangent
  vec3 newNormal = normalize(cross(displacedTangent, displacedBitangent));
  transformedNormal = normalMatrix * newNormal;

  vNormal = normalize(transformedNormal);
  
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
  vViewPosition = - mvPosition.xyz;
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
  #ifdef USE_TRANSMISSION
    vWorldPosition = worldPosition.xyz;
  #endif
}`;

export {vs};
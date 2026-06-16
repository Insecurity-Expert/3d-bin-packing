/**
 * BinViewer.jsx
 * Live 3-D packing visualiser using React Three Fiber.
 *
 * Accepts two equivalent prop shapes:
 *   (A) placements={[{item_idx, bin_id, x, y, z, l, h, d}]}
 *       container={{ L, H, D }}
 *       binsUsed={number}
 *
 *   (B) result={{ items:[...], container:{L,H,D}, bins_used:n }}
 *       (legacy – kept for backward compatibility)
 *
 * Colouring: golden-angle HSL hue per item_idx so every item is visually
 * distinct, even when items of the same type share a bin.
 * Each item gets a thin dark wireframe edge so boxes pop.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';

// ── Per-item colour using golden-angle hue ───────────────────────────────────
function itemHSL(itemIdx) {
  const hue = (itemIdx * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 70%, 60%)`;
}

// ── Container wireframe ───────────────────────────────────────────────────────
const WireBox = React.memo(function WireBox({ x, y, z, l, h, d }) {
  const geo = useMemo(() => new THREE.BoxGeometry(l, h, d), [l, h, d]);
  return (
    <lineSegments position={[x + l / 2, y + h / 2, z + d / 2]}>
      <edgesGeometry args={[geo]} />
      <lineBasicMaterial color="white" transparent opacity={0.35} />
    </lineSegments>
  );
});

// ── Packed item: solid face + dark edge outline ───────────────────────────────
const ItemBox = React.memo(function ItemBox({ x, y, z, l, h, d, itemIdx, id, showLabels }) {
  const [hovered, setHovered] = useState(false);
  const color   = useMemo(() => itemHSL(itemIdx), [itemIdx]);
  const faceGeo = useMemo(() => new THREE.BoxGeometry(l - 1, h - 1, d - 1), [l, h, d]);
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(faceGeo), [faceGeo]);
  const cx = x + l / 2, cy = y + h / 2, cz = z + d / 2;
  const boxId = id || `Box-${String(itemIdx + 1).padStart(3, '0')}`;

  // Calculate center coordinates relative to the mesh coordinate space
  const centerX = 0;
  const centerY = 0;
  const centerZ = 0;

  return (
    <group position={[cx, cy, cz]}>
      <mesh
        geometry={faceGeo}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
      >
        <meshStandardMaterial
          color={color}
          transparent
          opacity={hovered ? 0.95 : 0.82}
          emissive={hovered ? color : '#000000'}
          emissiveIntensity={hovered ? 0.45 : 0}
          roughness={0.35}
          metalness={0.08}
        />
        {(showLabels || hovered) && (
          <Html
            position={[centerX, centerY, centerZ]}
            center
            style={{
              background: 'rgba(255, 255, 255, 0.9)',
              color: 'black',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '12px',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              fontFamily: 'sans-serif',
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
              border: '1px solid rgba(0,0,0,0.1)'
            }}
          >
            {boxId}
          </Html>
        )}
      </mesh>
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color="#000000" transparent opacity={0.55} />
      </lineSegments>
    </group>
  );
});

// ── Main viewer ───────────────────────────────────────────────────────────────
export default function BinViewer({ result, placements: placementsProp, container: containerProp, binsUsed: binsUsedProp, showLabels }) {
  // Normalise to a single internal format
  const items     = result ? result.items      : (placementsProp || []);
  const container = result ? result.container  : containerProp;
  const binsUsed  = result ? result.bins_used  : (binsUsedProp || 0);

  const [currentStep, setCurrentStep] = useState(items.length);
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync currentStep when items count changes (e.g. running new optimization or finishing)
  useEffect(() => {
    setCurrentStep(items.length);
  }, [items.length]);

  // Autoplay handler
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= items.length) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, items.length]);

  // Slice items to current playback step
  const visibleItems = useMemo(() => {
    return items.slice(0, currentStep);
  }, [items, currentStep]);

  // Group items by bin — hook must come before any early return
  const byBin = useMemo(() => {
    const m = {};
    for (const it of visibleItems) {
      if (!m[it.bin_id]) m[it.bin_id] = [];
      m[it.bin_id].push(it);
    }
    return m;
  }, [visibleItems]);

  if (!container || !items || items.length === 0) return null;

  const { L, H, D } = container;
  const BIN_GAP     = L * 0.12;
  const binCount    = Math.max(binsUsed, ...Object.keys(byBin).map(Number)) + 1 || binsUsed;
  const totalWidth  = binCount * L + (binCount - 1) * BIN_GAP;
  const camDist     = Math.max(totalWidth, H, D) * 1.25;

  const targetX = totalWidth / 2;
  const targetY = H / 2;
  const targetZ = D / 2;

  return (
    <div style={{ width: '100%', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ width: '100%', height: 520, background: '#111827', position: 'relative' }}>
        <Canvas
          camera={{ position: [targetX, targetY + H * 0.8, targetZ + camDist], fov: 45 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.65} />
          <directionalLight position={[200, 400, 300]} intensity={0.8} />
          <directionalLight position={[-200, 100, -200]} intensity={0.3} />

          {Array.from({ length: binCount }, (_, binId) => {
            const offsetX  = binId * (L + BIN_GAP);
            const binItems = byBin[binId] || [];
            return (
              <group key={binId} position={[offsetX, 0, 0]}>
                <WireBox x={0} y={0} z={0} l={L} h={H} d={D} />
                {binItems.map((it) => (
                  <ItemBox
                    key={it.item_idx}
                    x={it.x} y={it.y} z={it.z}
                    l={it.l} h={it.h} d={it.d}
                    itemIdx={it.item_idx}
                    id={it.id}
                    showLabels={showLabels}
                  />
                ))}
              </group>
            );
          })}

          <OrbitControls makeDefault target={[targetX, targetY, targetZ]} />
        </Canvas>

        {/* Playback Controls Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 10,
            width: '90%',
            maxWidth: 550,
            backdropFilter: 'blur(4px)',
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (currentStep >= items.length) {
                setCurrentStep(0);
              }
              setIsPlaying(prev => !prev);
            }}
            style={{
              background: isPlaying ? '#ef4444' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: 70,
            }}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <input
            type="range"
            min="0"
            max={items.length}
            value={currentStep}
            onChange={(e) => {
              setCurrentStep(parseInt(e.target.value, 10));
              setIsPlaying(false);
            }}
            style={{
              flex: 1,
              cursor: 'pointer',
              accentColor: '#3b82f6',
            }}
          />

          <span style={{ color: '#f1f5f9', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 500 }}>
            Showing {currentStep} of {items.length}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 14, padding: '8px 16px',
        background: '#1f2937', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>
          {binCount} bin{binCount !== 1 ? 's' : ''} · {items.length} items
        </span>
        {Array.from({ length: Math.min(binCount, 8) }, (_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 12, height: 12, borderRadius: 2, border: '1px solid #374151',
              background: `hsl(${((byBin[i]?.[0]?.item_idx ?? i) * 137.508 % 360).toFixed(0)}, 70%, 60%)`,
            }} />
            <span style={{ color: '#9ca3af', fontSize: 12 }}>
              Bin {i} ({(byBin[i] || []).length})
            </span>
          </div>
        ))}
        {binCount > 8 && (
          <span style={{ color: '#6b7280', fontSize: 12 }}>+ {binCount - 8} more</span>
        )}
      </div>
    </div>
  );
}

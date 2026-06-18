import React, { useState } from 'react';

const data = {
  buyCallVol: [
    { strike: '7,400', vol: 6.0, displayVol: '6.0K' },
    { strike: '7,470', vol: 5.4, displayVol: '5.4K' },
    { strike: '7,505', vol: 1.3, displayVol: '1.3K' }
  ],
  sellCallVol: [
    { strike: '7,470', vol: 6.0, displayVol: '6.0K' },
    { strike: '7,510', vol: 2.4, displayVol: '2.4K' },
    { strike: '7,585', vol: 2.1, displayVol: '2.1K' }
  ],
  buyPutVol: [
    { strike: '7,240', vol: 11.4, displayVol: '11.4K' },
    { strike: '7,295', vol: 11.1, displayVol: '11.1K' },
    { strike: '7,250', vol: 10.3, displayVol: '10.3K' }
  ],
  sellPutVol: [
    { strike: '7,295', vol: 12.2, displayVol: '12.2K' },
    { strike: '7,260', vol: 11.5, displayVol: '11.5K' },
    { strike: '7,290', vol: 10.7, displayVol: '10.7K' }
  ]
};

const maxVol = 12.2;

const VolumeSection = ({ title, items, color }) => (
  <div style={{ marginBottom: '2rem' }}>
    <h3 style={{
      fontSize: '13px',
      fontWeight: '600',
      color: 'var(--color-text-primary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      marginBottom: '12px',
      margin: '0 0 12px 0'
    }}>
      {title}
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
          <div style={{ width: '16px', color: 'var(--color-text-secondary)', fontWeight: '500' }}>
            {idx + 1}
          </div>
          <div style={{ width: '56px', textAlign: 'right', fontWeight: '500', color: 'var(--color-text-primary)' }}>
            {item.strike}
          </div>
          <div style={{ flex: 1, position: 'relative', height: '20px', display: 'flex', alignItems: 'center' }}>
            <div style={{
              height: '8px',
              backgroundColor: color,
              borderRadius: '2px',
              width: `${(item.vol / maxVol) * 100}%`,
              transition: 'width 0.3s ease'
            }} />
          </div>
          <div style={{ width: '40px', textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            {item.displayVol}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default function OptionsVolumeDashboard() {
  return (
    <div style={{ padding: '0', fontFamily: 'var(--font-sans)', color: 'var(--color-text-primary)' }}>
      <div style={{
        fontSize: '12px',
        fontWeight: '600',
        color: 'var(--color-text-secondary)',
        marginBottom: '2rem',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        2026-06-10 | ODTE
      </div>

      <VolumeSection title="Buy call vol" items={data.buyCallVol} color="#4CAF50" />
      <VolumeSection title="Sell call vol" items={data.sellCallVol} color="#EF5350" />
      <VolumeSection title="Buy put vol" items={data.buyPutVol} color="#4CAF50" />
      <VolumeSection title="Sell put vol" items={data.sellPutVol} color="#EF5350" />
    </div>
  );
}
import { TypeIcon, EVENT_TYPE_KEYS, pt } from 'mobilizacao-pt-ui';

export function AllTypes() {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {EVENT_TYPE_KEYS.map((t) => (
        <li key={t} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type={t} size={22} />
          <span>{pt.eventTypes[t]}</span>
        </li>
      ))}
    </ul>
  );
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <TypeIcon type="demonstration" size={18} />
      <TypeIcon type="demonstration" size={22} />
      <TypeIcon type="demonstration" size={32} />
      <TypeIcon type="demonstration" size={48} />
    </div>
  );
}

import { useState } from 'react';
import { RadioChips } from 'mobilizacao-pt-ui';

const reasons = [
  { value: 'wrong', label: 'Informação errada' },
  { value: 'cancelled', label: 'Foi cancelado' },
  { value: 'spam', label: 'Spam ou abuso' },
  { value: 'other', label: 'Outro motivo' },
];

export function Selected() {
  const [v, setV] = useState('cancelled');
  return <RadioChips name="reason" legend="Motivo" options={reasons} value={v} onValue={setV} />;
}

export function NoneSelectedWithError() {
  const [v, setV] = useState('');
  return (
    <RadioChips name="reason-err" legend="Motivo" options={reasons} value={v} onValue={setV} error="Escolhe um motivo." />
  );
}

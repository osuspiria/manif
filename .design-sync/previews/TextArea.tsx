import { useState } from 'react';
import { TextArea } from 'mobilizacao-pt-ui';

export function WithCounter() {
  const [v, setV] = useState('Concentração na praça e desfile até à Assembleia. Traz cartazes e água.');
  return <TextArea id="description" label="Descrição (opcional)" value={v} onValue={setV} maxLength={1000} rows={4} />;
}

export function WithHint() {
  const [v, setV] = useState('');
  return (
    <TextArea
      id="report"
      label="O que se passa? (opcional)"
      hint="Não incluas dados pessoais."
      value={v}
      onValue={setV}
      rows={3}
    />
  );
}

export function WithError() {
  const [v, setV] = useState('ok');
  return <TextArea id="desc-err" label="Descrição" value={v} onValue={setV} error="A descrição é demasiado curta." />;
}

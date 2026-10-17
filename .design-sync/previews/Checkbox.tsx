import { useState } from 'react';
import { Checkbox } from 'mobilizacao-pt-ui';

export function Unchecked() {
  const [c, setC] = useState(false);
  return <Checkbox id="all-day" label="Todo o dia" checked={c} onChecked={setC} />;
}

export function Checked() {
  const [c, setC] = useState(true);
  return <Checkbox id="confirm" label="Confirmo que a informação é pública e verdadeira." checked={c} onChecked={setC} />;
}

import { LIMITS } from '../../config/app';
import { EVENT_TYPE_KEYS, type EventType } from '../../config/event-types';
import { pt } from '../../i18n/pt';
import { TypeIcon } from '../map/TypeIcon';
import { RadioChips, TextArea, TextField } from './fields';
import type { DetailsState, FieldErrors } from './form-state';

interface Props {
  value: DetailsState;
  onChange: (next: DetailsState) => void;
  errors: FieldErrors;
  /** Show the place label field here (edit page) instead of in the "Onde" step. */
  withPlaceLabel?: boolean;
}

export function EventDetailsFields({ value, onChange, errors, withPlaceLabel }: Props) {
  const set = <K extends keyof DetailsState>(k: K, v: DetailsState[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <>
      <RadioChips<EventType>
        name="type"
        legend={pt.add.what.type}
        value={value.type}
        onValue={(v) => set('type', v)}
        error={errors.type}
        options={EVENT_TYPE_KEYS.map((t) => ({
          value: t,
          label: (
            <>
              <TypeIcon type={t} size={18} />
              <span>{pt.eventTypes[t]}</span>
            </>
          ),
        }))}
      />
      <TextField
        id="title"
        label={pt.add.what.title}
        value={value.title}
        onValue={(v) => set('title', v)}
        error={errors.title}
        required
        maxLength={LIMITS.titleMax}
      />
      <TextArea
        id="description"
        label={pt.add.what.description}
        value={value.description}
        onValue={(v) => set('description', v)}
        error={errors.description}
        maxLength={LIMITS.descriptionMax}
        rows={4}
      />
      <TextField
        id="organizer"
        label={pt.add.what.organizer}
        hint={pt.add.what.organizerHint}
        value={value.organizer}
        onValue={(v) => set('organizer', v)}
        error={errors.organizer}
        maxLength={LIMITS.titleMax}
      />
      {withPlaceLabel && (
        <TextField
          id="placeLabel"
          label={pt.add.where.placeLabel}
          hint={pt.add.where.placeLabelHint}
          value={value.placeLabel}
          onValue={(v) => set('placeLabel', v)}
          error={errors.placeLabel}
          maxLength={LIMITS.titleMax}
        />
      )}
    </>
  );
}

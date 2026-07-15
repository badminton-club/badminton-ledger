import React from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { useAppDispatch, useAppSelector } from '../../../hooks';
import {
  setPlayersInput,
  setFormError,
  selectPlayersInput,
  selectFormError,
} from '../../../features/SessionModal/sessionModalSlice';

interface Props {
  onSubmit: (raw: string) => void;
  onCancel: () => void;
}

export default function PasteNamesStep({ onSubmit, onCancel }: Props) {
  const dispatch     = useAppDispatch();
  const playersInput = useAppSelector(selectPlayersInput);
  const formError    = useAppSelector(selectFormError);

  const handleNext = () => {
    if (!playersInput.trim()) {
      dispatch(setFormError('Player list cannot be empty.'));
      return;
    }
    onSubmit(playersInput);
  };

  return (
    <>
      {formError && (
        <Alert variant="danger" dismissible onClose={() => dispatch(setFormError(''))}>
          {formError}
        </Alert>
      )}

      <Form.Group className="mb-3">
        <Form.Label>Players</Form.Label>
        <Form.Control
          as="textarea"
          rows={12}
          placeholder={'Paste your numbered list here:\n1. John Smith\n2. Jane Doe'}
          value={playersInput}
          onChange={e => dispatch(setPlayersInput(e.target.value))}
        />
        <Form.Text muted>
          Accepts a numbered list (1. Name) or plain names separated by newlines or commas.
        </Form.Text>
      </Form.Group>

      <div className="d-flex justify-content-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary"   onClick={handleNext}>Next: Confirm Players</Button>
      </div>
    </>
  );
}

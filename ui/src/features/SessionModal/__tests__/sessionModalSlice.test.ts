import reducer, {
  setMode,
  setPlayersInput,
  setResolutionItems,
  updateResolutionItem,
  setConfirmedPlayers,
  setFormError,
  setAddError,
  clearErrors,
  resetModal,
  selectModalMode,
  selectPlayersInput,
  selectResolutionItems,
  selectConfirmedPlayers,
  selectFormError,
  selectAddError,
  selectAllResolved,
} from '../sessionModalSlice';
import type { RootState } from '../../../store';
import type { NameResolutionItem, ConfirmedPlayer } from 'types';

const initialState = reducer(undefined, { type: '@@INIT' });

function makeResolutionItem(overrides: Partial<NameResolutionItem> = {}): NameResolutionItem {
  return {
    rawName: 'John Smith',
    resolvedPlayerId: null,
    isNew: false,
    ...overrides,
  } as NameResolutionItem;
}

describe('sessionModalSlice reducer', () => {
  it('has the expected initial state', () => {
    expect(initialState).toEqual({
      mode: 'view',
      playersInput: '',
      resolutionItems: [],
      confirmedPlayers: [],
      errors: {},
    });
  });

  it('setMode sets the modal mode', () => {
    expect(reducer(initialState, setMode('paste')).mode).toBe('paste');
  });

  it('setPlayersInput sets the raw pasted-names text', () => {
    expect(reducer(initialState, setPlayersInput('John, Jane')).playersInput).toBe('John, Jane');
  });

  it('setResolutionItems replaces the resolution list', () => {
    const items = [makeResolutionItem()];
    expect(reducer(initialState, setResolutionItems(items)).resolutionItems).toEqual(items);
  });

  it('updateResolutionItem patches only the item at the given index', () => {
    const items = [makeResolutionItem({ rawName: 'A' }), makeResolutionItem({ rawName: 'B' })];
    const withItems = reducer(initialState, setResolutionItems(items));
    const updated = reducer(withItems, updateResolutionItem({ index: 1, patch: { resolvedPlayerId: 'p2' } }));
    expect(updated.resolutionItems[0]).toEqual(items[0]);
    expect(updated.resolutionItems[1]).toEqual({ ...items[1], resolvedPlayerId: 'p2' });
  });

  it('updateResolutionItem is a no-op for an out-of-range index', () => {
    const items = [makeResolutionItem()];
    const withItems = reducer(initialState, setResolutionItems(items));
    const updated = reducer(withItems, updateResolutionItem({ index: 5, patch: { resolvedPlayerId: 'p1' } }));
    expect(updated.resolutionItems).toEqual(items);
  });

  it('setConfirmedPlayers replaces the confirmed players list', () => {
    const confirmed = [{ id: 'p1', percentage: 100 } as ConfirmedPlayer];
    expect(reducer(initialState, setConfirmedPlayers(confirmed)).confirmedPlayers).toEqual(confirmed);
  });

  it('setFormError sets errors.form, and clears it (to undefined) when given an empty string', () => {
    const withError = reducer(initialState, setFormError('Something went wrong'));
    expect(withError.errors.form).toBe('Something went wrong');
    const cleared = reducer(withError, setFormError(''));
    expect(cleared.errors.form).toBeUndefined();
  });

  it('setAddError sets errors.add, and clears it (to undefined) when given an empty string', () => {
    const withError = reducer(initialState, setAddError('Duplicate player'));
    expect(withError.errors.add).toBe('Duplicate player');
    const cleared = reducer(withError, setAddError(''));
    expect(cleared.errors.add).toBeUndefined();
  });

  it('clearErrors resets both error fields at once', () => {
    let state = reducer(initialState, setFormError('form error'));
    state = reducer(state, setAddError('add error'));
    state = reducer(state, clearErrors());
    expect(state.errors).toEqual({});
  });

  it('resetModal restores the initial state', () => {
    let state = reducer(initialState, setMode('paste'));
    state = reducer(state, setPlayersInput('John'));
    state = reducer(state, resetModal());
    expect(state).toEqual(initialState);
  });
});

describe('sessionModalSlice selectors', () => {
  function makeRootState(sessionModal: ReturnType<typeof reducer>): RootState {
    return { sessionModal } as RootState;
  }

  it('basic field selectors read their fields', () => {
    const state = {
      ...initialState,
      mode: 'edit' as const,
      playersInput: 'John',
      resolutionItems: [makeResolutionItem()],
      confirmedPlayers: [{ id: 'p1', percentage: 100 } as ConfirmedPlayer],
      errors: { form: 'oops', add: 'oops2' },
    };
    const root = makeRootState(state);
    expect(selectModalMode(root)).toBe('edit');
    expect(selectPlayersInput(root)).toBe('John');
    expect(selectResolutionItems(root)).toEqual(state.resolutionItems);
    expect(selectConfirmedPlayers(root)).toEqual(state.confirmedPlayers);
    expect(selectFormError(root)).toBe('oops');
    expect(selectAddError(root)).toBe('oops2');
  });

  describe('selectAllResolved', () => {
    it('is false when there are no resolution items at all', () => {
      expect(selectAllResolved(makeRootState(initialState))).toBe(false);
    });

    it('is false when any item lacks a resolvedPlayerId', () => {
      const state = {
        ...initialState,
        resolutionItems: [
          makeResolutionItem({ resolvedPlayerId: 'p1' }),
          makeResolutionItem({ resolvedPlayerId: null }),
        ],
      };
      expect(selectAllResolved(makeRootState(state))).toBe(false);
    });

    it('is true when every item has a resolvedPlayerId', () => {
      const state = {
        ...initialState,
        resolutionItems: [
          makeResolutionItem({ resolvedPlayerId: 'p1' }),
          makeResolutionItem({ resolvedPlayerId: 'p2' }),
        ],
      };
      expect(selectAllResolved(makeRootState(state))).toBe(true);
    });
  });
});

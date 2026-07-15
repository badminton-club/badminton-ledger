import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './store';

/** Pre-typed dispatch — handles async thunks correctly. */
export const useAppDispatch = () => useDispatch<AppDispatch>();

/** Pre-typed selector — no need to annotate state type at every call site. */
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

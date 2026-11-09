import { getFunctions, httpsCallable } from 'firebase/functions';
import { autoLinkPlayerByEmail } from '../playerLinking';
import { auth } from '../client';
import { resetFirebaseTestState, setCurrentUser } from '../../../test-utils/firebaseTestHelpers';

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => 'functions'),
  httpsCallable: jest.fn(),
}));

const call = Object.assign(jest.fn(), { stream: jest.fn() });
const functions = { app: auth.app, region: 'us-central1', customDomain: null };
beforeEach(() => {
  jest.clearAllMocks();
  resetFirebaseTestState();
  jest.mocked(getFunctions).mockReturnValue(functions);
  jest.mocked(httpsCallable).mockReturnValue(call);
  call.mockResolvedValue({ data: { linked: 1, conflicts: 0 } });
});

it('calls the verified-account endpoint without passing any user-chosen email, club, or player', async () => {
  const getIdToken = jest.fn().mockResolvedValue('verified-token');
  setCurrentUser({ uid: 'user', email: 'player@example.com', displayName: null, emailVerified: true, getIdToken });
  await expect(autoLinkPlayerByEmail()).resolves.toEqual({ linked: 1, conflicts: 0 });
  expect(getIdToken).toHaveBeenCalledWith(true);
  expect(getFunctions).toHaveBeenCalledWith(auth.app, 'us-central1');
  expect(httpsCallable).toHaveBeenCalledWith(functions, 'linkPlayerByEmail');
  expect(call).toHaveBeenCalledWith({});
});

it('rejects signed-out and unverified accounts without contacting the backend', async () => {
  await expect(autoLinkPlayerByEmail()).rejects.toThrow('verified email');
  setCurrentUser({ uid: 'user', email: 'player@example.com', displayName: null, emailVerified: false });
  await expect(autoLinkPlayerByEmail()).rejects.toThrow('verified email');
  expect(call).not.toHaveBeenCalled();
});

it.each([null, {}, { linked: -1, conflicts: 0 }, { linked: 0, conflicts: '0' }, { linked: 1.5, conflicts: 0 }])(
  'rejects invalid backend results: %p', async (data) => {
    setCurrentUser({ uid: 'user', email: 'player@example.com', displayName: null, emailVerified: true });
    call.mockResolvedValue({ data });
    await expect(autoLinkPlayerByEmail()).rejects.toThrow('invalid result');
  }
);

it('surfaces backend failures rather than pretending no matches exist', async () => {
  setCurrentUser({ uid: 'user', email: 'player@example.com', displayName: null, emailVerified: true });
  call.mockRejectedValue(new Error('Service unavailable'));
  await expect(autoLinkPlayerByEmail()).rejects.toThrow('Service unavailable');
});

it('discards a response if the account changes while the request is running', async () => {
  setCurrentUser({ uid: 'user', email: 'player@example.com', displayName: null, emailVerified: true });
  call.mockImplementationOnce(async () => {
    setCurrentUser(null);
    return { data: { linked: 1, conflicts: 0 } };
  });
  await expect(autoLinkPlayerByEmail()).rejects.toThrow('account changed');
});

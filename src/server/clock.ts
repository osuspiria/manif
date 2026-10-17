/** The only place on the server that reads the system time; injected into routes. */
export type Clock = () => Date;

// eslint-disable-next-line no-restricted-syntax -- system clock adapter
export const systemClock: Clock = () => new Date();

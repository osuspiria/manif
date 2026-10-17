/** The only place in the browser code that reads the system time. */
// eslint-disable-next-line no-restricted-syntax -- system clock adapter
export const currentTime = (): Date => new Date();

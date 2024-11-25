export let error = (message: string | Error): never => {
  if (message instanceof Error) {
    throw message;
  } else {
    throw new Error(message);
  }
};

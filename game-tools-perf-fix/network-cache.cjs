(function (root) {
  function createReader() {
    const parsed = new WeakMap();
    return response => {
      if (!parsed.has(response)) parsed.set(response, Promise.resolve().then(() => response.clone().json()));
      return parsed.get(response);
    };
  }
  function observe(response, reader, onData) {
    // Run side work separately: game fetch consumers must not await tool decoding.
    Promise.resolve().then(() => reader(response)).then(onData).catch(() => {});
    return response;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createReader, observe };
  else { root.__gtReadJSON = createReader(); root.__gtObserveResponse = observe; }
})(typeof window !== 'undefined' ? window : globalThis);

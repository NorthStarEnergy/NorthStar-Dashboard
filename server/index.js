// The legacy static Sites pipeline is retired. Keep accidental deployments fail-closed.
export default {
  fetch() {
    return Response.redirect('https://northstarenergy.ca/', 302);
  },
};

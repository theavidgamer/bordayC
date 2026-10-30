// Late-bound hooks so screens can open each other without circular imports.
export const hooks = {
  openCustomer: (_name, _id) => {},   // quick customer window
  openProfile: (_key) => {},          // full customer profile (Customers tab)
  openOrder: (_order) => {},          // order window
  newOrderFor: (_customer) => {},     // Counter prefilled
  goTo: (_tab) => {}
};

import { App } from "#/types";
import { create } from "zustand";

type HomeStore = {
  bookings: App.Booking[];
  setBookings(bookings: App.Booking[]): void;
  clearBookings(): void;
}

const useHomeStore = create<HomeStore>((set) => ({
  bookings: [],
  setBookings: (bookings) => set({ bookings }),
  clearBookings: () => set({ bookings: [] }),
}));

export default useHomeStore;
# Lessons Learned

- Always check fallback capability definitions when dealing with async status probing caches.
- Ensure async background detection tasks can be awaited when dependent services (like consultation coordinators) require warm state.

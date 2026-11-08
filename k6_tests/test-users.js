const password = 'LoadTest123!';

export const testUsers = Array.from({ length: 1000 }, (_, index) => {
  const suffix = String(index + 1).padStart(3, '0');

  return {
    name: `Load Test User ${suffix}`,
    username: `loadtest_user_${suffix}`,
    password,
    phoneNumber: `+1555${String(index + 1).padStart(7, '0')}`,
  };
});

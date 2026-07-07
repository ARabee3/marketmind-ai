export type User = {
  id: string
  email: string
  fullName: string
}

export type LoginCredentials = {
  email: string
  password: string
}

export type AuthResponse = {
  accessToken: string
  user: User
}

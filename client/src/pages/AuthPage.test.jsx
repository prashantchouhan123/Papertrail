import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthPage } from "./AuthPage.jsx";

const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("../auth.jsx", () => ({ useAuth: () => mocks }));

describe("authentication screens", () => {
  beforeEach(() => { mocks.login.mockReset(); mocks.register.mockReset(); });
  afterEach(() => cleanup());

  it("renders the sign-in form with email and password fields", () => {
    render(<MemoryRouter><AuthPage mode="login"/></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Sign in to continue" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("renders the registration form with a minimum password length", () => {
    render(<MemoryRouter><AuthPage mode="register"/></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Create your workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeRequired();
    expect(screen.getAllByLabelText("Password").at(-1)).toHaveAttribute("minLength", "10");
  });

  it("links sign-in users to registration", () => {
    render(<MemoryRouter><AuthPage mode="login"/></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/register");
  });
});

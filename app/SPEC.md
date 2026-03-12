# RGem App — Behavioral Specifications

Executable specifications for the RGem web app, written in BDD (Behavior-Driven Development) style.
Each scenario describes a tested and passing user flow.

---

## Feature: URL-Based Gem Selection (Deeplink Support)

Gem IDs are first-class parts of the URL. Navigating to `/{gemId}` connects directly to that gem.
The root path `/` always shows the entry modal.

---

### Scenario: Visit root path — modal shown with empty state

```gherkin
Given the user navigates to "/"
Then the "Connect to an RGEM" modal is displayed
And the Gem ID input is empty
And no error message is shown
And the Connect button is disabled
```

---

### Scenario: Connect via modal — URL updates and grid loads

```gherkin
Given the user is at "/"
When the user types a valid Gem ID (e.g. "test-1") into the input
And clicks the Connect button
Then the URL changes to "/test-1"
And a "Connecting to RGEM…" overlay is displayed
And when the connection is established, the overlay is dismissed
And the 4×4 grid is displayed and interactive
```

---

### Scenario: Connect via modal — Enter key submits the form

```gherkin
Given the user is at "/"
And has typed a valid Gem ID into the input
When the user presses the Enter key
Then the form is submitted (same behavior as clicking Connect)
```

---

### Scenario: Browser back from gem page — returns to modal

```gherkin
Given the user has navigated to "/test-1" and the grid is loaded
When the user presses the browser Back button
Then the URL returns to "/"
And the "Connect to an RGEM" modal is displayed with an empty input
And no error message is shown
```

---

### Scenario: Hard refresh or direct navigation to gem URL — grid loads without modal

```gherkin
Given the network is available and the backend is reachable
When the user navigates directly to "/test-1" (e.g. via hard refresh or pasting the URL)
Then the app connects to "test-1" automatically
And the "Connecting to RGEM…" overlay is displayed during the connection
And when the connection is established, the overlay is dismissed
And the 4×4 grid is displayed without ever showing the modal
```

---

### Scenario: Navigate to an invalid path — redirect to modal with validation error

```gherkin
Given the user navigates to a URL with an invalid Gem ID (e.g. "/bad!!id")
Then the URL is silently replaced with "/"
And the "Connect to an RGEM" modal is displayed
And the error "Gem ID can only contain letters, numbers, and hyphens (max 24 characters)" is shown
```

---

### Scenario: Connect button disabled while input is empty

```gherkin
Given the user is at "/"
And the Gem ID input is empty
Then the Connect button is disabled
```

---

### Scenario: Inline validation error for invalid characters

```gherkin
Given the user is at "/"
When the user types an invalid Gem ID (e.g. "bad id!") into the input
And clicks the Connect button (or presses Enter)
Then the error "Gem ID can only contain letters, numbers, and hyphens (max 24 characters)" is shown inline
And no connection is attempted
And the URL remains "/"
```

---

### Scenario: Inline validation error clears on input change

```gherkin
Given an inline validation error is displayed
When the user modifies the input
Then the validation error is cleared
```

---

### Scenario: Connection failure on initial navigate — modal shown with pre-filled error

```gherkin
Given the network is unavailable or the backend is unreachable
When the user navigates to "/test-1"
Then the app attempts to connect
And a "Connecting to RGEM…" overlay is displayed
And after the connection attempt fails, the URL is replaced with "/"
And the "Connect to an RGEM" modal is displayed
And the Gem ID input is pre-filled with "test-1"
And the error "Could not connect to 'test-1'. Check the ID and try again." is shown
```

---

### Scenario: Network drops while connected — overlay shown, then timeout redirects to modal

```gherkin
Given the user is connected and viewing the grid at "/test-1"
When the network becomes unavailable
Then a "Connecting to RGEM…" overlay is displayed over the grid
And the app attempts to reconnect in the background
And if reconnection does not succeed within 15 seconds
Then the URL is replaced with "/"
And the "Connect to an RGEM" modal is displayed
And the Gem ID input is pre-filled with "test-1"
And the error "Could not connect to 'test-1'. Check the ID and try again." is shown
```

---

### Scenario: Network recovers before reconnect timeout — overlay dismissed

```gherkin
Given the user is at "/test-1" and the "Connecting to RGEM…" overlay is displayed due to a dropped connection
When the network becomes available again and the socket reconnects within 15 seconds
Then the overlay is dismissed
And the grid is displayed and interactive
And the URL remains "/test-1"
```

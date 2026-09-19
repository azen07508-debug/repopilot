# Secret Leak Sample

A test fixture for the secret scanner. RepoPilot should detect these.

```ts
const aws = "AKIAIOSFODNN7EXAMPLE";
const gh = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// Split so this fixture does not trip upstream secret scanners such as
// GitHub push protection. The joined value is still a valid sample.
const stripe = "sk_live_" + "abcdefghijklmnopqrstuvwx";
```

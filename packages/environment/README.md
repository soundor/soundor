# @soundor/environment

The types of Soundor's JavaScript environment, for libraries that run in
Soundor plugins: `soundor:ui`, image and font imports, and exactly the Web
globals the runtime provides, in place of the DOM. Types only; install it as a
development dependency.

```jsonc
{
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["@soundor/environment"],
  },
}
```

- [Writing a UI library](https://soundor.dev/docs/ui-library)
- [Documentation](https://soundor.dev/docs)

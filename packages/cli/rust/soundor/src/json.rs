//! Persistent state values as the runtimes store them: Soundor's state
//! JSON (`stateJson()` in `@soundor/core`), which a controller reads and
//! writes through the runtime's state store, as the UI does. 64-bit
//! integers are decimal strings, enums their value, structs objects keyed
//! by their config field names, nullable values `null` or the value.

use std::fmt::Write as _;

/// A parsed JSON value.
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    /// `null`.
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// A number, as written.
    Number(String),
    /// A string.
    String(String),
    /// An array.
    Array(Vec<Json>),
    /// An object, its members in order.
    Object(Vec<(String, Json)>),
}

/// Why a value is not the state's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError(pub String);

impl std::fmt::Display for JsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for JsonError {}

fn error<T>(message: impl Into<String>) -> Result<T, JsonError> {
    Err(JsonError(message.into()))
}

/// A value of a persistent state field's type.
pub trait StateValue: Sized {
    /// Appends the value's JSON.
    fn write_json(&self, out: &mut String) -> Result<(), JsonError>;
    /// Reads the value from its JSON.
    fn read_json(value: &Json) -> Result<Self, JsonError>;
}

/// The JSON of `value`.
pub fn to_json<T: StateValue>(value: &T) -> Result<String, JsonError> {
    let mut out = String::new();
    value.write_json(&mut out)?;
    Ok(out)
}

/// `value` read from `text`.
pub fn from_json<T: StateValue>(text: &str) -> Result<T, JsonError> {
    T::read_json(&parse(text)?)
}

/// Appends `text` as a JSON string.
pub fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_float(value: f64, out: &mut String) -> Result<(), JsonError> {
    if !value.is_finite() {
        return error("state numbers are finite");
    }
    // Rust's Display never uses an exponent, and is the shortest that reads
    // back as the same double: valid JSON either way.
    let _ = write!(out, "{value}");
    Ok(())
}

/// A JSON object's member, by name.
pub fn member<'a>(members: &'a [(String, Json)], name: &str) -> Result<&'a Json, JsonError> {
    members
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
        .ok_or_else(|| JsonError(format!("missing state field: {name}")))
}

impl StateValue for bool {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        out.push_str(if *self { "true" } else { "false" });
        Ok(())
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        match value {
            Json::Bool(value) => Ok(*value),
            _ => error("expected a boolean"),
        }
    }
}

impl StateValue for String {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        write_string(self, out);
        Ok(())
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        match value {
            Json::String(value) => Ok(value.clone()),
            _ => error("expected a string"),
        }
    }
}

macro_rules! small_numbers {
    ($($type:ty),*) => {$(
        impl StateValue for $type {
            fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
                write_float(f64::from(*self), out)
            }
            fn read_json(value: &Json) -> Result<Self, JsonError> {
                let Json::Number(text) = value else {
                    return error("expected a number");
                };
                let number: f64 = text.parse().map_err(|_| JsonError("invalid number".into()))?;
                let converted = number as $type;
                if f64::from(converted) != number {
                    return error(concat!("not a ", stringify!($type)));
                }
                Ok(converted)
            }
        }
    )*};
}
small_numbers!(i8, u8, i16, u16, i32, u32);

impl StateValue for f32 {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        write_float(f64::from(*self), out)
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        f64::read_json(value).map(|value| value as f32)
    }
}

impl StateValue for f64 {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        write_float(*self, out)
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        match value {
            Json::Number(text) => text.parse().map_err(|_| JsonError("invalid number".into())),
            _ => error("expected a number"),
        }
    }
}

macro_rules! wide_numbers {
    ($($type:ty),*) => {$(
        impl StateValue for $type {
            fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
                let _ = write!(out, "\"{self}\"");
                Ok(())
            }
            fn read_json(value: &Json) -> Result<Self, JsonError> {
                match value {
                    Json::String(text) => text
                        .parse()
                        .map_err(|_| JsonError(concat!("not a ", stringify!($type)).into())),
                    _ => error("expected a decimal string"),
                }
            }
        }
    )*};
}
wide_numbers!(i64, u64);

impl<T: StateValue> StateValue for Vec<T> {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        out.push('[');
        for (index, value) in self.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            value.write_json(out)?;
        }
        out.push(']');
        Ok(())
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        match value {
            Json::Array(values) => values.iter().map(T::read_json).collect(),
            _ => error("expected an array"),
        }
    }
}

impl<T: StateValue> StateValue for Option<T> {
    fn write_json(&self, out: &mut String) -> Result<(), JsonError> {
        match self {
            None => {
                out.push_str("null");
                Ok(())
            }
            Some(value) => value.write_json(out),
        }
    }
    fn read_json(value: &Json) -> Result<Self, JsonError> {
        match value {
            Json::Null => Ok(None),
            value => T::read_json(value).map(Some),
        }
    }
}

/// Parses `text`, nested at most 64 deep.
pub fn parse(text: &str) -> Result<Json, JsonError> {
    let mut parser = Parser {
        bytes: text.as_bytes(),
        at: 0,
    };
    let value = parser.value(0)?;
    parser.whitespace();
    if parser.at != parser.bytes.len() {
        return error("trailing JSON");
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn whitespace(&mut self) {
        while matches!(self.bytes.get(self.at), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.at += 1;
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, JsonError> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            error("invalid JSON")
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, JsonError> {
        if depth > 64 {
            return error("JSON nesting limit");
        }
        self.whitespace();
        match self.bytes.get(self.at) {
            Some(b'n') => self.literal("null", Json::Null),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'"') => self.string().map(Json::String),
            Some(b'[') => {
                self.at += 1;
                let mut values = Vec::new();
                self.whitespace();
                if self.bytes.get(self.at) == Some(&b']') {
                    self.at += 1;
                    return Ok(Json::Array(values));
                }
                loop {
                    values.push(self.value(depth + 1)?);
                    self.whitespace();
                    match self.bytes.get(self.at) {
                        Some(b',') => self.at += 1,
                        Some(b']') => {
                            self.at += 1;
                            return Ok(Json::Array(values));
                        }
                        _ => return error("invalid JSON array"),
                    }
                }
            }
            Some(b'{') => {
                self.at += 1;
                let mut members = Vec::new();
                self.whitespace();
                if self.bytes.get(self.at) == Some(&b'}') {
                    self.at += 1;
                    return Ok(Json::Object(members));
                }
                loop {
                    self.whitespace();
                    let key = self.string()?;
                    self.whitespace();
                    if self.bytes.get(self.at) != Some(&b':') {
                        return error("invalid JSON object");
                    }
                    self.at += 1;
                    members.push((key, self.value(depth + 1)?));
                    self.whitespace();
                    match self.bytes.get(self.at) {
                        Some(b',') => self.at += 1,
                        Some(b'}') => {
                            self.at += 1;
                            return Ok(Json::Object(members));
                        }
                        _ => return error("invalid JSON object"),
                    }
                }
            }
            Some(b'-' | b'0'..=b'9') => {
                let start = self.at;
                while matches!(
                    self.bytes.get(self.at),
                    Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                ) {
                    self.at += 1;
                }
                let text = std::str::from_utf8(&self.bytes[start..self.at]).expect("ASCII");
                if text.parse::<f64>().is_err() {
                    return error("invalid JSON number");
                }
                Ok(Json::Number(text.to_owned()))
            }
            _ => error("invalid JSON"),
        }
    }

    fn hex(&mut self) -> Result<u32, JsonError> {
        let digits = self
            .bytes
            .get(self.at..self.at + 4)
            .ok_or_else(|| JsonError("invalid JSON escape".into()))?;
        let text =
            std::str::from_utf8(digits).map_err(|_| JsonError("invalid JSON escape".into()))?;
        self.at += 4;
        u32::from_str_radix(text, 16).map_err(|_| JsonError("invalid JSON escape".into()))
    }

    fn string(&mut self) -> Result<String, JsonError> {
        if self.bytes.get(self.at) != Some(&b'"') {
            return error("expected a JSON string");
        }
        self.at += 1;
        let mut out = Vec::new();
        loop {
            let Some(&byte) = self.bytes.get(self.at) else {
                return error("unterminated JSON string");
            };
            self.at += 1;
            match byte {
                b'"' => break,
                b'\\' => {
                    let Some(&escape) = self.bytes.get(self.at) else {
                        return error("invalid JSON escape");
                    };
                    self.at += 1;
                    let decoded = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let high = self.hex()?;
                            let code = if (0xd800..0xdc00).contains(&high) {
                                if self.bytes.get(self.at..self.at + 2) != Some(b"\\u") {
                                    return error("invalid JSON surrogate");
                                }
                                self.at += 2;
                                let low = self.hex()?;
                                if !(0xdc00..0xe000).contains(&low) {
                                    return error("invalid JSON surrogate");
                                }
                                0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00)
                            } else {
                                high
                            };
                            char::from_u32(code)
                                .ok_or_else(|| JsonError("invalid JSON escape".into()))?
                        }
                        _ => return error("invalid JSON escape"),
                    };
                    let mut buffer = [0; 4];
                    out.extend_from_slice(decoded.encode_utf8(&mut buffer).as_bytes());
                }
                byte => out.push(byte),
            }
        }
        String::from_utf8(out).map_err(|_| JsonError("invalid UTF-8".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_values_round_trip_through_their_json() {
        assert_eq!(to_json(&7u64).unwrap(), "\"7\"");
        assert_eq!(
            from_json::<u64>("\"18446744073709551615\"").unwrap(),
            u64::MAX
        );
        assert_eq!(to_json(&vec![60i32, 64]).unwrap(), "[60,64]");
        assert_eq!(to_json(&0.25f64).unwrap(), "0.25");
        assert_eq!(
            from_json::<f32>(&to_json(&0.1f32).unwrap()).unwrap(),
            0.1f32
        );
        assert_eq!(
            to_json(&Some(String::from("a\"b\n"))).unwrap(),
            "\"a\\\"b\\n\""
        );
        assert_eq!(from_json::<Option<String>>(" null ").unwrap(), None);
        assert_eq!(
            from_json::<String>("\"\\ud83c\\udfb5 \\u00e9\"").unwrap(),
            "🎵 é"
        );
        assert!(from_json::<i32>("1.5").is_err());
        assert!(from_json::<u8>("300").is_err());
        assert!(to_json(&f64::NAN).is_err());
        assert!(parse("[1,]").is_err());
        assert!(parse(&"[".repeat(80)).is_err());
    }
}

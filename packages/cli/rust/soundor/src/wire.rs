//! How native method arguments and results cross the controller's C ABI:
//! the values of soundor.config's native types, laid out by their type
//! alone, which both sides know from the config (the engine from the
//! controller's descriptor). Little-endian, unaligned, no tags:
//!
//! - `boolean`: one byte, 0 or 1;
//! - sized numbers: their bytes;
//! - `string`: its UTF-8 length as a `u32`, then its bytes;
//! - `T[]` and `buffer<T>`: the element count as a `u32`, then the elements;
//! - `T?`: one byte, 0 for null or 1, then the value;
//! - an enum: its value's index as a `u32`;
//! - a struct: its fields, in declaration order.
//!
//! The engine writes what JavaScript passed, checked as the C++ bindings
//! check it; a value that does not decode is the engine's bug, reported as
//! an invalid call rather than trusted.

/// A value that crosses the ABI.
pub trait Wire: Sized {
    /// Appends the value.
    fn encode(&self, out: &mut Vec<u8>);
    /// Reads one value.
    fn decode(input: &mut Reader<'_>) -> Result<Self, WireError>;
}

/// The bytes of a call, read in order.
pub struct Reader<'a> {
    bytes: &'a [u8],
}

/// What a malformed value was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireError(pub &'static str);

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "malformed native value: {}", self.0)
    }
}

impl std::error::Error for WireError {}

impl<'a> Reader<'a> {
    /// A reader of `bytes`.
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    /// The next `count` bytes.
    pub fn take(&mut self, count: usize) -> Result<&'a [u8], WireError> {
        if self.bytes.len() < count {
            return Err(WireError("truncated"));
        }
        let (taken, rest) = self.bytes.split_at(count);
        self.bytes = rest;
        Ok(taken)
    }

    /// A count (a string's, an array's): checked against what is left, so a
    /// corrupt one never allocates beyond the input.
    pub fn count(&mut self, element_size: usize) -> Result<usize, WireError> {
        let count = u32::decode(self)? as usize;
        if count.saturating_mul(element_size.max(1)) > self.bytes.len() {
            return Err(WireError("count beyond the input"));
        }
        Ok(count)
    }

    /// Fails unless every byte was read.
    pub fn finish(self) -> Result<(), WireError> {
        if self.bytes.is_empty() {
            Ok(())
        } else {
            Err(WireError("trailing bytes"))
        }
    }
}

/// Encodes one value.
pub fn to_bytes<T: Wire>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.encode(&mut out);
    out
}

macro_rules! numbers {
    ($($type:ty),*) => {$(
        impl Wire for $type {
            fn encode(&self, out: &mut Vec<u8>) {
                out.extend_from_slice(&self.to_le_bytes());
            }
            fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
                let bytes = input.take(std::mem::size_of::<$type>())?;
                Ok(<$type>::from_le_bytes(bytes.try_into().expect("sized")))
            }
        }
    )*};
}
numbers!(i8, u8, i16, u16, i32, u32, i64, u64, f32, f64);

impl Wire for () {
    fn encode(&self, _: &mut Vec<u8>) {}
    fn decode(_: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(())
    }
}

impl Wire for bool {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(u8::from(*self));
    }
    fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
        match u8::decode(input)? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(WireError("boolean")),
        }
    }
}

fn length(count: usize) -> u32 {
    u32::try_from(count).expect("a native value holds at most 4 GiB")
}

impl Wire for String {
    fn encode(&self, out: &mut Vec<u8>) {
        length(self.len()).encode(out);
        out.extend_from_slice(self.as_bytes());
    }
    fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
        let count = input.count(1)?;
        let bytes = input.take(count)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| WireError("UTF-8"))
    }
}

impl<T: Wire> Wire for Vec<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        length(self.len()).encode(out);
        for value in self {
            value.encode(out);
        }
    }
    fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
        // Every element takes a byte at least, but `()` none: only for it can
        // a count be larger than the input.
        let count = input.count(usize::from(std::mem::size_of::<T>() > 0))?;
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(T::decode(input)?);
        }
        Ok(values)
    }
}

impl<T: Wire> Wire for Option<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            None => out.push(0),
            Some(value) => {
                out.push(1);
                value.encode(out);
            }
        }
    }
    fn decode(input: &mut Reader<'_>) -> Result<Self, WireError> {
        match u8::decode(input)? {
            0 => Ok(None),
            1 => Ok(Some(T::decode(input)?)),
            _ => Err(WireError("nullable tag")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip<T: Wire + PartialEq + std::fmt::Debug>(value: T) {
        let bytes = to_bytes(&value);
        let mut reader = Reader::new(&bytes);
        assert_eq!(T::decode(&mut reader).unwrap(), value);
        reader.finish().unwrap();
    }

    #[test]
    fn values_round_trip() {
        round_trip(true);
        round_trip(-5i8);
        round_trip(u64::MAX);
        round_trip(i64::MIN);
        round_trip(1.5f32);
        round_trip(-0.25f64);
        round_trip(String::from("héllo"));
        round_trip(vec![1.0f32, 2.0, 3.0]);
        round_trip(vec![Some(String::new()), None]);
        round_trip(Option::<Vec<i32>>::None);
    }

    #[test]
    fn the_layout_is_the_documented_one() {
        assert_eq!(to_bytes(&String::from("ab")), [2, 0, 0, 0, b'a', b'b']);
        assert_eq!(to_bytes(&vec![1u16, 2]), [2, 0, 0, 0, 1, 0, 2, 0]);
        assert_eq!(to_bytes(&Some(true)), [1, 1]);
        assert_eq!(to_bytes(&Option::<bool>::None), [0]);
    }

    #[test]
    fn malformed_input_is_refused_without_allocating_its_counts() {
        let mut reader = Reader::new(&[0xff, 0xff, 0xff, 0x7f]);
        assert!(Vec::<u8>::decode(&mut reader).is_err());
        assert!(bool::decode(&mut Reader::new(&[2])).is_err());
        assert!(String::decode(&mut Reader::new(&[1, 0, 0, 0, 0xff])).is_err());
        assert!(Reader::new(&[0]).finish().is_err());
    }
}

/// Don't remember where I got this from
/// - Didn't touch anything, just importing

/**
  The Colour object allows conversion of colours between strings and several
  other colour spaces.

  The colour has two public members. It's type is the type of colour space. Its
  values are an array of numbers specifying the colour coordinates. These
  coordinates depend on the type of colour space used.

  @constructor
  @param {number} type
  @param {Array.<number>} values
 */

function Colour(type, values) {
  this.type = type;
  this.values = values;

  if (this.values.length < 4) {
    throw "Bad value";
  }
}

// Here is an enumeration of colour spaces.

// RGBA. All components are in the range 0..1
Colour.RGBA = 0;

// CIE XYZ, with added alpha value.
Colour.XYZA = 1;

// Hue/Saturation/Value. Hue is in the range 0...360 and the others are 0...1
Colour.HSVA = 2;

// CIE LAB 1976 colour space, with added alpha component.
Colour.LABA = 3;

Colour.LAST_COLOURSPACE = 3;

Colour.prototype = {
  /**
      Returns a new colour object, converting to the given colour space.

      @param {number} type
      @return {Colour}
     */

  convertTo: function (type) {
    return Colour.converters[this.type][type](this);
  },

  /**
      Returns the distance between this colour and another, using the colour
      space of this colour. If the other colour is another colour space, it is
      converted before the calculation is done.
     */
  distanceTo: function (colour) {
    if (colour.type !== this.type) {
      colour = colour.convertTo(this.type);
    }

    if (this.type === Colour.HSVA) {
      // Hue goes from 0 to 360, unlike other colour schemes, so it needs
      // to be scaled relative to the other values. It must also wrap
      // around.

      var a = this.values[0],
        b = colour.values[0];
      var hueDiff;
      if (a > b) {
        hueDiff = Math.min(a - b, b - a + 360);
      } else {
        hueDiff = Math.min(b - a, a - b + 360);
      }

      hueDiff /= 360;

      return Math.pow(
        hueDiff * hueDiff +
          (this.values[1] - colour.values[1]) *
            (this.values[1] - colour.values[1]) +
          (this.values[2] - colour.values[2]) *
            (this.values[2] - colour.values[2]),
        0.5
      );
    } else {
      return Math.pow(
        (this.values[0] - colour.values[0]) *
          (this.values[0] - colour.values[0]) +
          (this.values[1] - colour.values[1]) *
            (this.values[1] - colour.values[1]) +
          (this.values[2] - colour.values[2]) *
            (this.values[2] - colour.values[2]),
        0.5
      );
    }
  },
};

(function () {
  var WHITE = { X: 0.9505, Y: 1.0, Z: 1.089 }; // D65

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_HSVA_RGBA(clr) {
    var h = clr.values[0];
    var s = clr.values[1];
    var v = clr.values[2];
    if (h < 0) {
      h += 360;
    }
    var hi = Math.floor(h / 60) % 6;
    var f = h / 60 - Math.floor(h / 60);
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (hi) {
      case 0:
        r = v;
        g = t;
        b = p;
        break;
      case 1:
        r = q;
        g = v;
        b = p;
        break;
      case 2:
        r = p;
        g = v;
        b = t;
        break;
      case 3:
        r = p;
        g = q;
        b = v;
        break;
      case 4:
        r = t;
        g = p;
        b = v;
        break;
      case 5:
        r = v;
        g = p;
        b = q;
        break;
    }

    return new Colour(Colour.RGBA, [r, g, b, clr.values[3]]);
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_RGBA_HSVA(clr) {
    var h, s, v;
    var r = clr.values[0];
    var g = clr.values[1];
    var b = clr.values[2];
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    if (max === min) {
      h = 0;
    } else if (max === r) {
      h = ((60 * (g - b)) / (max - min) + 360) % 360;
    } else if (max === g) {
      h = (60 * (b - r)) / (max - min) + 120;
    } else if (max === b) {
      h = (60 * (r - g)) / (max - min) + 240;
    }

    if (max === 0) {
      s = 0;
    } else {
      s = 1 - min / max;
    }

    v = max;

    return new Colour(Colour.HSVA, [h, s, v, clr.values[3]]);
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_XYZA_LABA(clr) {
    function f(t) {
      if (t > (6.0 / 29.0) * (6.0 / 29.0) * (6.0 / 29.0)) {
        return Math.pow(t, 1.0 / 3.0);
      } else {
        return (1.0 / 3.0) * (29.0 / 6.0) * (29.0 / 6.0) * t + 4.0 / 29.0;
      }
    }

    var X = f(clr.values[0] / WHITE.X);
    var Y = f(clr.values[1] / WHITE.Y);
    var Z = f(clr.values[2] / WHITE.Z);

    return new Colour(Colour.LABA, [
      116 * Y - 16,
      500 * (X - Y),
      200 * (Y - Z),
      clr.values[3],
    ]);
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_LABA_XYZA(clr) {
    var fy = (clr.values[0] + 16) / 116;
    var fx = fy + clr.values[1] / 500;
    var fz = fy - clr.values[2] / 200;

    var squiggle = 6.0 / 29;
    var X, Y, Z;

    if (fy > squiggle) {
      Y = WHITE.Y * fy * fy * fy;
    } else {
      Y = (fy - 16.0 / 116) * 3 * squiggle * squiggle * WHITE.Y;
    }

    if (fx > squiggle) {
      X = WHITE.X * fx * fx * fx;
    } else {
      X = (fx - 16.0 / 116) * 3 * squiggle * squiggle * WHITE.X;
    }

    if (fz > squiggle) {
      Z = WHITE.Z * fz * fz * fz;
    } else {
      Z = (fz - 16.0 / 116) * 3 * squiggle * squiggle * WHITE.Z;
    }

    return new Colour(Colour.XYZA, [X, Y, Z, clr.values[3]]);
  }

  /**
      @param {Colour} rgb
      @return {Colour}
     */

  function convert_RGBA_XYZA(rgb) {
    var temp = [];

    for (var i = 0; i < 3; i++) {
      if (rgb.values[i] <= 0.04045) {
        temp[i] = rgb.values[i] / 12.92;
      } else {
        temp[i] = Math.pow((rgb.values[i] + 0.055) / 1.055, 2.4);
      }
    }

    return new Colour(Colour.XYZA, [
      0.4124 * temp[0] + 0.3576 * temp[1] + 0.1805 * temp[2],
      0.2126 * temp[0] + 0.7152 * temp[1] + 0.0722 * temp[2],
      0.0193 * temp[0] + 0.1192 * temp[1] + 0.9505 * temp[2],
      rgb.values[3],
    ]);
  }

  /**
      @param {Colour} xyz
      @return {Colour}
     */

  function convert_XYZA_RGBA(xyz) {
    var temp = [];
    var values = [];

    temp[0] =
      3.241 * xyz.values[0] - 1.5374 * xyz.values[1] - 0.4986 * xyz.values[2];
    temp[1] =
      -0.9692 * xyz.values[0] + 1.876 * xyz.values[1] + 0.0416 * xyz.values[2];
    temp[2] =
      0.0556 * xyz.values[0] - 0.204 * xyz.values[1] + 1.057 * xyz.values[2];

    for (var i = 0; i < 3; i++) {
      if (temp[i] <= 0.0031308) {
        values[i] = 12.92 * temp[i];
      } else {
        values[i] = 1.055 * Math.pow(temp[i], 1.0 / 2.4) - 0.055;
      }
    }

    values[3] = xyz.values[3];

    return new Colour(Colour.RGBA, values);
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_SAME(clr) {
    return new Colour(clr.type, clr.values.concat());
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_RGBA_LABA(clr) {
    return convert_XYZA_LABA(convert_RGBA_XYZA(clr));
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_LABA_RGBA(clr) {
    return convert_XYZA_RGBA(convert_LABA_XYZA(clr));
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_XYZA_HSVA(clr) {
    return convert_RGBA_HSVA(convert_XYZA_RGBA(clr));
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_HSVA_XYZA(clr) {
    return convert_RGBA_XYZA(convert_HSVA_RGBA(clr));
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_HSVA_LABA(clr) {
    return convert_RGBA_LABA(convert_HSVA_RGBA(clr));
  }

  /**
      @param {Colour} clr
      @return {Colour}
     */

  function convert_LABA_HSVA(clr) {
    return convert_XYZA_HSVA(convert_LABA_XYZA(clr));
  }

  Colour.converters = [
    [convert_SAME, convert_RGBA_XYZA, convert_RGBA_HSVA, convert_RGBA_LABA],

    [convert_XYZA_RGBA, convert_SAME, convert_XYZA_HSVA, convert_XYZA_LABA],

    [convert_HSVA_RGBA, convert_HSVA_XYZA, convert_SAME, convert_HSVA_LABA],

    [convert_LABA_RGBA, convert_LABA_XYZA, convert_LABA_HSVA, convert_SAME],
  ];
})();

export default Colour;

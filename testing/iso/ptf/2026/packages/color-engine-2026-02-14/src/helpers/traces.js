// const createTraceableInstance = () => {
//   // /**
//   //  * @type {Record<number, { profileHandle: number, colorSpace: string, profileName: string }>}
//   //  */
//   // const profileMap = {};

//   // /**
//   //  * @type {Record<string, {}>}
//   //  */
//   // const transformMap = {};

//   // const getProfileFromHandle = profileHandle => {
//   //   // We need to expose LittleCMS API's similar to how it is done in the `upstream/lcms-wasm` package
//   //   const colorSpace = Module._cmsGetColorSpaceASCII(profileHandle);
//   //   const profileName = Module._cmsGetProfileInfoASCII(profileHandle, Module._cmsInfoDescription, "en", "US");

//   //   return { profileHandle, colorSpace, profileName };
//   // };

//   const interfaces = {
//     'createTransform': ({
//       arguments: [inputProfile, inputFormat, outputProfile, outputFormat, renderingIntent, flags], 
//       result: transformHandle, 
//       error
//     }) => ({
//       functionName: 'createTransform',
//       inputProfile,
//       inputFormat,
//       outputProfile,
//       outputFormat,
//       renderingIntent,
//       flags,
//       transformHandle,
//       error
//     }),
//     'createMultiprofileTransform': ({
//       arguments: [profileHandles, inputFormat, outputFormat, renderingIntent, flags],
//       result: transformHandle,
//       error
//     }) => ({
//       functionName: 'createMultiprofileTransform',
//       profileHandles,
//       inputFormat,
//       outputFormat,
//       renderingIntent,
//       flags,
//       transformHandle,
//       error
//     }),
//     'doTransform': ({
//       arguments: [transform, inputBuffer, outputBuffer, pixelCount],
//       result,
//       error
//     }) => ({
//       functionName: 'doTransform',
//       transform,
//       inputBuffer,
//       outputBuffer,
//       pixelCount,
//       result,
//       error
//     }),
//   };

//   const proxyHandler = {
//     apply(target, thisArg, argumentsList) {
//     }
//   };
// };

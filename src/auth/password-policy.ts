// 비밀번호 규칙·해시 비용. 회원가입과 비밀번호 변경이 함께 쓴다
export const BCRYPT_COST = 10;

// 8~64자, 영문과 숫자를 각각 1자 이상
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
